#!/usr/bin/env bash
set -euo pipefail

export HA_TOKEN="$SUPERVISOR_TOKEN"
export HA_URL="http://supervisor/core"

PERSIST_DIR=/homeassistant/.claudecode
mkdir -p "$PERSIST_DIR/config" /root/.config

cat > "$PERSIST_DIR/CLAUDE.md" <<'EOF'
# Claude Code - Home Assistant Add-on

## Path Mapping

In this add-on container, paths are mapped differently than HA Core:
- `/homeassistant` = HA config directory (equivalent to `/config` in HA Core)
- `/config` does NOT exist - always use `/homeassistant`

When users mention `/config/...`, translate to `/homeassistant/...`

## Available Paths

| Path | Description | Access |
|------|-------------|--------|
| `/homeassistant` | HA configuration | read-write |
| `/share` | Shared folder | read-write |
| `/media` | Media files | read-write |
| `/ssl` | SSL certificates | read-only |
| `/backup` | Backups | read-only |

## Home Assistant Integration

Use the `homeassistant` MCP server to query entities and call services.

## Reading Home Assistant Logs

**Log levels (from most to least verbose):**
- `debug` - Only shown if explicitly enabled in configuration.yaml
- `info` - General information, shown by default
- `warning` - Warnings, always shown
- `error` - Errors, always shown

**Commands to read logs:**
```bash
# View recent logs (ha CLI)
ha core logs 2>&1 | tail -100

# Filter by keyword
ha core logs 2>&1 | grep -i keyword

# Filter errors only
ha core logs 2>&1 | grep -iE "(error|exception)"

# Alternative: read log file directly
tail -100 /homeassistant/home-assistant.log
```

**To enable debug logging for an integration**, add to `configuration.yaml`:
```yaml
logger:
  default: info
  logs:
    custom_components.YOUR_INTEGRATION: debug
```

**Key insight:** `_LOGGER.debug()` calls are invisible unless the logger level is set to debug.
Use `_LOGGER.info()` or `_LOGGER.warning()` for logs that should always appear.
EOF

if [ ! -L /root/.claude ]; then
  rm -rf /root/.claude
  ln -s "$PERSIST_DIR" /root/.claude
fi

# Ensure settings.json exists so jq can patch it
if [ ! -f "$PERSIST_DIR/settings.json" ]; then
  echo '{"permissions":{"allow":[]}}' > "$PERSIST_DIR/settings.json"
fi

if [ ! -L /root/.config/claude-code ]; then
  rm -rf /root/.config/claude-code
  ln -s "$PERSIST_DIR/config" /root/.config/claude-code
fi

if [ ! -L /root/.claude.json ]; then
  touch "$PERSIST_DIR/.claude.json"
  rm -f /root/.claude.json
  ln -s "$PERSIST_DIR/.claude.json" /root/.claude.json
fi

FONT_SIZE=$(jq -r '.terminal_font_size // 14' /data/options.json)
THEME=$(jq -r '.terminal_theme // "dark"' /data/options.json)
SESSION_PERSIST=$(jq -r '.session_persistence // true' /data/options.json)
ENABLE_MCP=$(jq -r '.enable_mcp // true' /data/options.json)
ENABLE_PLAYWRIGHT=$(jq -r '.enable_playwright_mcp // false' /data/options.json)
PLAYWRIGHT_HOST=$(jq -r '.playwright_cdp_host // ""' /data/options.json)
AUTO_UPDATE=$(jq -r '.auto_update_claude // true' /data/options.json)
WORK_DIR=$(jq -r '.working_directory // "/homeassistant"' /data/options.json)

if [ -z "$PLAYWRIGHT_HOST" ] && [ "$ENABLE_PLAYWRIGHT" = "true" ]; then
  echo '[INFO] Auto-detecting Playwright Browser hostname...'
  PLAYWRIGHT_HOST=$(curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/addons | jq -r '.data.addons[] | select(.slug | endswith("playwright-browser") or endswith("_playwright-browser")) | .hostname' | head -1)
  if [ -n "$PLAYWRIGHT_HOST" ] && [ "$PLAYWRIGHT_HOST" != "null" ]; then
    echo "[INFO] Found Playwright Browser: $PLAYWRIGHT_HOST"
  else
    echo '[WARN] Playwright Browser add-on not found, using default hostname'
    PLAYWRIGHT_HOST="playwright-browser"
  fi
fi

if [ "$AUTO_UPDATE" = "true" ]; then
  echo '[INFO] Checking for Claude Code updates...'
  npm update -g @anthropic-ai/claude-code 2>/dev/null || echo '[WARN] Update check failed, continuing...'
fi

claude mcp remove homeassistant -s user 2>/dev/null || true
claude mcp remove playwright -s user 2>/dev/null || true

if [ "$ENABLE_MCP" = "true" ]; then
  claude mcp add-json homeassistant '{"command":"hass-mcp"}' -s user
  SETTINGS_FILE=/root/.claude/settings.json
  ALLOWED_TOOLS='["mcp__homeassistant__get_version","mcp__homeassistant__get_entity","mcp__homeassistant__list_entities","mcp__homeassistant__search_entities_tool","mcp__homeassistant__domain_summary_tool","mcp__homeassistant__list_automations","mcp__homeassistant__get_history","mcp__homeassistant__get_error_log","Read(/homeassistant/**)","Read(/config/**)","Read(/share/**)","Read(/media/**)","Glob(/homeassistant/**)","Glob(/config/**)","Grep(/homeassistant/**)","Grep(/config/**)"]'
  jq --argjson tools "$ALLOWED_TOOLS" '.permissions.allow = ($tools + (.permissions.allow // []) | unique)' "$SETTINGS_FILE" > /tmp/settings.tmp && mv /tmp/settings.tmp "$SETTINGS_FILE"
  echo '[INFO] MCP configured with Home Assistant integration'
  echo '[INFO] Pre-authorized read-only MCP tools'
else
  echo '[INFO] MCP disabled'
fi

if [ "$ENABLE_PLAYWRIGHT" = "true" ]; then
  claude mcp add-json playwright "{\"command\":\"npx\",\"args\":[\"--no-install\",\"@playwright/mcp\",\"--cdp-endpoint\",\"http://${PLAYWRIGHT_HOST}:9222\"]}" -s user
  echo "[INFO] Playwright MCP enabled (CDP: http://${PLAYWRIGHT_HOST}:9222)"
  echo '[INFO] Make sure the Playwright Browser add-on is installed and running'
else
  echo '[INFO] Playwright MCP disabled'
fi

if [ "$THEME" = "dark" ]; then
  COLORS='background=#1e1e2e,foreground=#cdd6f4,cursor=#f5e0dc'
else
  COLORS='background=#eff1f5,foreground=#4c4f69,cursor=#dc8a78'
fi

if [ "$SESSION_PERSIST" = "true" ]; then
  tmux kill-session -t claude 2>/dev/null || true
  SHELL_CMD="tmux new-session -A -s claude -c ${WORK_DIR}"
else
  SHELL_CMD='bash --login'
fi

ttyd --port 7682 --writable --ping-interval 30 --max-clients 5 \
  --cwd "$WORK_DIR" \
  -t fontSize="$FONT_SIZE" \
  -t fontFamily=Monaco,Consolas,monospace \
  -t scrollback=20000 \
  -t "theme=$COLORS" \
  $SHELL_CMD &

TTYD_PID=$!
cleanup() { kill "$TTYD_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

cd /homeassistant
exec node /opt/claudecode-overlay/server.js
