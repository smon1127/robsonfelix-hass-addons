ARG BUILD_FROM
FROM ${BUILD_FROM}

LABEL maintainer="Robson Felix"
LABEL org.opencontainers.image.title="Claude Code for Home Assistant"
LABEL org.opencontainers.image.description="Claude Code CLI with web terminal and HA integration"
LABEL org.opencontainers.image.source="https://github.com/robsonfelix/robsonfelix-hass-addons"
LABEL org.opencontainers.image.licenses="MIT"

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color \
    NODE_PATH=/opt/claudecode-proxy/node_modules

RUN apk add --no-cache \
    bash \
    curl \
    git \
    github-cli \
    jq \
    nodejs \
    npm \
    openssh-client \
    libstdc++ \
    ncurses \
    vim \
    nano \
    tmux \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    ca-certificates \
    openssl \
    ripgrep \
    p7zip \
    socat \
    docker-cli \
    python3 \
 && update-ca-certificates

ARG BUILD_ARCH
RUN case "${BUILD_ARCH}" in \
      amd64) TTYD_ARCH="x86_64" ;; \
      aarch64) TTYD_ARCH="aarch64" ;; \
      armv7|armhf) TTYD_ARCH="armhf" ;; \
      i386) TTYD_ARCH="i686" ;; \
      *) TTYD_ARCH="x86_64" ;; \
    esac \
 && curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" -o /usr/bin/ttyd \
 && chmod +x /usr/bin/ttyd

RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /opt/claudecode-proxy \
 && cd /opt/claudecode-proxy \
 && npm init -y \
 && npm install --omit=dev http-proxy

RUN pip3 install --no-cache-dir --break-system-packages hass-mcp pymodbus pyserial

RUN apk add --no-cache --virtual .build-deps \
    build-base \
    cmake \
    libmodbus-dev \
 && git clone https://github.com/epsilonrt/mbpoll.git /tmp/mbpoll \
 && cd /tmp/mbpoll \
 && mkdir build \
 && cd build \
 && cmake .. \
 && make \
 && make install \
 && cd / \
 && rm -rf /tmp/mbpoll \
 && apk del .build-deps \
 && apk add --no-cache libmodbus

ENV NPM_CONFIG_CACHE=/root/.npm
RUN npx @playwright/mcp --version || true

RUN case "${BUILD_ARCH}" in \
      amd64) HA_ARCH="amd64" ;; \
      aarch64) HA_ARCH="aarch64" ;; \
      armv7|armhf) HA_ARCH="armhf" ;; \
      i386) HA_ARCH="i386" ;; \
      *) HA_ARCH="amd64" ;; \
    esac \
 && curl -fsSL "https://github.com/home-assistant/cli/releases/latest/download/ha_${HA_ARCH}" -o /usr/local/bin/ha \
 && chmod +x /usr/local/bin/ha

RUN mkdir -p /homeassistant /root/.config /root/.local/bin

RUN cat > /root/.tmux.conf <<'EOF'
set -g history-limit 20000
set -ga terminal-overrides ',xterm*:smcup@:rmcup@'
set -g mouse on
bind -n WheelUpPane if-shell -F -t = "#{mouse_any_flag}" "send-keys -M" "if -Ft= '#{pane_in_mode}' 'send-keys -M' 'select-pane -t=; copy-mode -e; send-keys -M'"
bind -n WheelDownPane select-pane -t= \; send-keys -M
EOF

RUN cat > /root/.bashrc <<'EOF'
export TERM=xterm-256color
export LANG=C.UTF-8
PS1='\[\033[1;36m\]claude-code\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]\$ '

update_mcp_token() {
  local SETTINGS_FILE=/root/.claude/settings.json
  if [ -f "$SETTINGS_FILE" ] && [ -n "$SUPERVISOR_TOKEN" ]; then
    jq ".mcpServers.homeassistant.env.HASS_TOKEN = \"$SUPERVISOR_TOKEN\"" "$SETTINGS_FILE" > /tmp/settings.tmp 2>/dev/null && mv /tmp/settings.tmp "$SETTINGS_FILE"
  fi
}

alias ll='ls -la'
alias c='update_mcp_token && claude'
alias cc='update_mcp_token && claude --continue'
alias ha-config='cd /homeassistant'
alias ha-logs='cat /homeassistant/home-assistant.log 2>/dev/null || echo "Log not found"'
EOF

RUN echo 'source ~/.bashrc' > /root/.profile

COPY server.js /opt/claudecode-proxy/server.js
COPY overlay.js /opt/claudecode-proxy/overlay.js
COPY start.sh /usr/local/bin/start-claudecode.sh
RUN chmod +x /usr/local/bin/start-claudecode.sh \
 && chmod 644 /opt/claudecode-proxy/server.js /opt/claudecode-proxy/overlay.js

ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /homeassistant

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:7681/ || exit 1

ENTRYPOINT []
CMD ["/usr/local/bin/start-claudecode.sh"]
