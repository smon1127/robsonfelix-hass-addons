(function () {
  'use strict';
  var isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  var SEQUENCES = {
    Escape: '\x1b',
    Tab: '\t',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
  };

  var ctrlActive = false;
  var selMode = false;
  var BAR_H = 44;

  function getTextarea() {
    return document.querySelector('.xterm-helper-textarea');
  }

  function focusTerm() {
    var ta = getTextarea();
    if (ta) ta.focus({ preventScroll: true });
  }

  function toggleKeyboard() {
    var ta = getTextarea();
    if (!ta) return;
    if (kbOpen) {
      // iOS WKWebView won't dismiss keyboard on blur() alone.
      // Set inputmode=none to tell iOS no keyboard is needed, then blur.
      ta.setAttribute('inputmode', 'none');
      ta.blur();
      // Also try: move focus to a non-input element
      bar.focus();
      kbOpen = false;
      // Restore inputmode after keyboard is dismissed
      setTimeout(function () { ta.setAttribute('inputmode', 'text'); }, 500);
    } else {
      ta.setAttribute('inputmode', 'text');
      ta.focus({ preventScroll: true });
      kbOpen = true;
    }
    var btn = document.getElementById('kb-kbd');
    if (btn) btn.classList.toggle('kb-active', kbOpen);
    // Don't reset customH — keep user's resize position
    setTimeout(updateLayout, 300);
  }

  function sendData(data) {
    var t = window.term;
    if (!t) return false;
    try {
      var core = t._core;
      if (core) {
        var svc = core.coreService || core._coreService;
        if (svc && typeof svc.triggerDataEvent === 'function') {
          svc.triggerDataEvent(data, true);
          return true;
        }
      }
      if (typeof t.paste === 'function') { t.paste(data); return true; }
    } catch (e) {}
    return false;
  }

  function sendSeq(name) {
    sendData(SEQUENCES[name]);
    clearCtrl();
  }

  function sendCtrlChar(ch) {
    var code = ch.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) sendData(String.fromCharCode(code - 64));
    clearCtrl();
  }

  function clearCtrl() {
    ctrlActive = false;
    var btn = document.getElementById('kb-ctrl');
    if (btn) btn.classList.remove('kb-active');
  }

  function toggleCtrl() {
    ctrlActive = !ctrlActive;
    var btn = document.getElementById('kb-ctrl');
    if (btn) btn.classList.toggle('kb-active', ctrlActive);
  }

  var optActive = false;

  function toggleOpt() {
    optActive = !optActive;
    var btn = document.getElementById('kb-opt');
    if (btn) btn.classList.toggle('kb-active', optActive);
  }

  function clearOpt() {
    optActive = false;
    var btn = document.getElementById('kb-opt');
    if (btn) btn.classList.remove('kb-active');
  }

  function onTermKeydown(e) {
    if (ctrlActive && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      sendCtrlChar(e.key);
      return;
    }
    if (optActive && e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      sendData('\x1b' + e.key);
      clearOpt();
    }
  }

  // -- Selection mode --
  var selStartCell = null;
  var selOverlay = null;

  function getCellDims() {
    var t = window.term;
    if (!t || !t._core) return null;
    var rs = t._core._renderService;
    if (rs && rs.dimensions) {
      var d = rs.dimensions;
      var w = (d.css && d.css.cell && d.css.cell.width) || d.actualCellWidth;
      var h = (d.css && d.css.cell && d.css.cell.height) || d.actualCellHeight;
      if (w && h) return { w: w, h: h };
    }
    var screen = document.querySelector('.xterm-screen');
    if (screen && t.cols && t.rows) {
      var rect = screen.getBoundingClientRect();
      return { w: rect.width / t.cols, h: rect.height / t.rows };
    }
    return null;
  }

  function touchToCell(touch) {
    var screen = document.querySelector('.xterm-screen');
    var dims = getCellDims();
    var t = window.term;
    if (!screen || !dims || !t) return null;
    var rect = screen.getBoundingClientRect();
    var col = Math.floor((touch.clientX - rect.left) / dims.w);
    var row = Math.floor((touch.clientY - rect.top) / dims.h);
    col = Math.max(0, Math.min(col, t.cols - 1));
    row = Math.max(0, Math.min(row, t.rows - 1));
    return { col: col, row: row };
  }

  function selectRange(start, end) {
    var t = window.term;
    if (!t) return;
    var r1 = start.row, c1 = start.col, r2 = end.row, c2 = end.col;
    if (r1 > r2 || (r1 === r2 && c1 > c2)) {
      var tmp = r1; r1 = r2; r2 = tmp;
      tmp = c1; c1 = c2; c2 = tmp;
    }
    var len = r1 === r2 ? c2 - c1 + 1 : (t.cols - c1) + (r2 - r1 - 1) * t.cols + (c2 + 1);
    t.select(c1, r1 + t.buffer.active.viewportY, len);
  }

  // -- Two-finger scroll in selection mode --
  var scrollState = {
    active: false,
    lastY: 0,
    remainder: 0,      // fractional accumulated pixels
    inertiaV: 0,       // current inertia velocity (px per frame)
    inertiaTimer: 0,
    lastTime: 0,
    velocities: [],     // recent velocity samples for averaging
  };

  function getRowHeight() {
    var dims = getCellDims();
    return dims ? dims.h : 18;
  }

  function scrollByArrows(dy) {
    // Accumulate sub-row pixel movement, emit arrow keys when full rows crossed
    scrollState.remainder += dy;
    var rowH = getRowHeight();
    var rows = Math.trunc(scrollState.remainder / rowH);
    if (rows === 0) return;
    scrollState.remainder -= rows * rowH;
    var seq = rows > 0 ? SEQUENCES.ArrowDown : SEQUENCES.ArrowUp;
    var count = Math.abs(rows);
    // Cap to prevent flooding
    if (count > 10) count = 10;
    for (var i = 0; i < count; i++) sendData(seq);
  }

  function startInertia() {
    cancelInertia();
    if (Math.abs(scrollState.inertiaV) < 1) return;
    var friction = 0.92;
    function tick() {
      scrollState.inertiaV *= friction;
      if (Math.abs(scrollState.inertiaV) < 1) { scrollState.inertiaV = 0; return; }
      scrollByArrows(scrollState.inertiaV);
      scrollState.inertiaTimer = requestAnimationFrame(tick);
    }
    scrollState.inertiaTimer = requestAnimationFrame(tick);
  }

  function cancelInertia() {
    if (scrollState.inertiaTimer) {
      cancelAnimationFrame(scrollState.inertiaTimer);
      scrollState.inertiaTimer = 0;
    }
    scrollState.inertiaV = 0;
  }

  function onSelTouchStart(e) {
    e.preventDefault();
    cancelInertia();
    if (e.touches.length >= 2) {
      // Two-finger: start scroll mode
      scrollState.active = true;
      scrollState.lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      scrollState.remainder = 0;
      scrollState.lastTime = Date.now();
      scrollState.velocities = [];
    } else {
      // One finger: selection
      scrollState.active = false;
      var cell = touchToCell(e.touches[0]);
      if (cell) selStartCell = cell;
    }
  }

  function onSelTouchMove(e) {
    e.preventDefault();
    if (scrollState.active && e.touches.length >= 2) {
      var curY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      var dy = curY - scrollState.lastY;
      var now = Date.now();
      var dt = now - scrollState.lastTime;
      // Natural scroll direction: swipe up = scroll up (negative dy = ArrowUp)
      scrollByArrows(-dy);
      // Track velocity for inertia (pixels per 16ms frame)
      if (dt > 0) {
        var v = (-dy / dt) * 16;
        scrollState.velocities.push(v);
        if (scrollState.velocities.length > 5) scrollState.velocities.shift();
      }
      scrollState.lastY = curY;
      scrollState.lastTime = now;
    } else if (!scrollState.active && e.touches.length === 1) {
      var cell = touchToCell(e.touches[0]);
      if (cell && selStartCell) selectRange(selStartCell, cell);
    }
  }

  function onSelTouchEnd(e) {
    if (scrollState.active && e.touches.length < 2) {
      // Calculate average velocity for inertia
      var vels = scrollState.velocities;
      if (vels.length > 0) {
        var sum = 0;
        for (var i = 0; i < vels.length; i++) sum += vels[i];
        scrollState.inertiaV = sum / vels.length;
        startInertia();
      }
      scrollState.active = false;
    }
  }

  function enableSelMode() {
    selMode = true;
    document.getElementById('kb-sel').classList.add('kb-active');
    document.getElementById('kb-copy').style.display = '';
    var screen = document.querySelector('.xterm-screen');
    if (screen && screen.parentElement) {
      if (!selOverlay) {
        selOverlay = document.createElement('div');
        selOverlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:crosshair;touch-action:none;';
      }
      screen.parentElement.style.position = 'relative';
      screen.parentElement.appendChild(selOverlay);
      selOverlay.addEventListener('touchstart', onSelTouchStart, { passive: false });
      selOverlay.addEventListener('touchmove', onSelTouchMove, { passive: false });
      selOverlay.addEventListener('touchend', onSelTouchEnd, { passive: false });
    }
  }

  function disableSelMode() {
    selMode = false;
    selStartCell = null;
    cancelInertia();
    document.getElementById('kb-sel').classList.remove('kb-active');
    document.getElementById('kb-copy').style.display = 'none';
    if (selOverlay && selOverlay.parentElement) {
      selOverlay.removeEventListener('touchstart', onSelTouchStart);
      selOverlay.removeEventListener('touchmove', onSelTouchMove);
      selOverlay.removeEventListener('touchend', onSelTouchEnd);
      selOverlay.parentElement.removeChild(selOverlay);
    }
    if (window.term) window.term.clearSelection();
  }

  function copySelection() {
    var t = window.term;
    if (!t) return;
    var text = t.getSelection();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('Copied!'); }, function () { fbCopy(text); });
    } else { fbCopy(text); }
  }

  function fbCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copied!'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function fallbackPaste() {
    // Create a temporary textarea, focus it, and use execCommand('paste')
    var ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    try {
      if (document.execCommand('paste')) {
        var text = ta.value;
        if (text) { sendData(text); showToast('Pasted!'); }
        else { showToast('Clipboard empty or blocked'); }
      } else {
        showToast('Long-press terminal to paste');
      }
    } catch (e) {
      showToast('Long-press terminal to paste');
    }
    document.body.removeChild(ta);
    focusTerm();
  }

  function showToast(msg) {
    var el = document.getElementById('kb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kb-toast';
      el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999999;padding:8px 20px;border-radius:8px;background:rgba(0,0,0,0.8);color:#fff;font-size:14px;font-family:-apple-system,system-ui,sans-serif;pointer-events:none;transition:opacity 0.3s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.style.opacity = '0'; }, 1200);
  }

  // -- Resize handle --
  var customH = 0; // 0 = auto, >0 = user-set height

  function onResizeTouchStart(e) {
    e.preventDefault();
    var startY = e.touches[0].clientY;
    var startBarTop = bar.getBoundingClientRect().top;
    var btn = document.getElementById('kb-resize');
    if (btn) btn.classList.add('kb-active');

    function onMove(ev) {
      ev.preventDefault();
      var dy = ev.touches[0].clientY - startY;
      var newTermH = Math.max(100, Math.min(startBarTop + dy, fullH - BAR_H));
      customH = newTermH;
      setHeight(newTermH + BAR_H);
    }
    function onEnd() {
      if (btn) btn.classList.remove('kb-active');
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  function getCurrentTermH() {
    var xterm = document.querySelector('.xterm');
    if (xterm) return xterm.getBoundingClientRect().height;
    return window.innerHeight - BAR_H;
  }

  // -- CSS --
  var css = document.createElement('style');
  css.textContent =
    'html,body{margin:0;padding:0;overflow:hidden !important;height:100vh;height:100dvh;' +
    'position:fixed !important;width:100%;top:0;left:0;touch-action:none;}' +
    '#kb-bar{position:fixed;left:0;right:0;z-index:99999;' +
    'display:flex;align-items:center;height:' + BAR_H + 'px;padding:0 3px;' +
    'background:#1a1a1a;border-top:1px solid #333;gap:2px;' +
    'overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;' +
    'user-select:none;-webkit-user-select:none;font-family:-apple-system,system-ui,sans-serif;}' +
    '#kb-bar::-webkit-scrollbar{display:none;}' +
    '#kb-bar{scrollbar-width:none;-ms-overflow-style:none;}' +
    '#kb-bar button{flex:0 0 auto;white-space:nowrap;height:38px;min-width:44px;padding:0 12px;margin:0;' +
    'border:0;border-radius:6px;background:#2d2d2d;color:#e0e0e0;' +
    'font-size:15px;font-weight:500;line-height:38px;text-align:center;' +
    'touch-action:manipulation;-webkit-tap-highlight-color:transparent;}' +
    '#kb-bar button.kb-flash{background:#555;color:#fff;transition:none;}' +
    '#kb-bar button.kb-active{background:#3478f6;color:#fff;}' +
    '#kb-bar button.kb-icon{font-size:16px;min-width:44px;padding:0 10px;}' +
    '#kb-bar button.kb-icon i{pointer-events:none;}' +
    '#kb-bar button.kb-resize{cursor:ns-resize;font-size:16px;min-width:44px;padding:0 10px;' +
    'background:#333;touch-action:none;}' +
    // Style ttyd overlay messages (e.g. "Press Enter to Reconnect")
    '.xterm .xterm-overlay{font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif !important;' +
    'font-size:15px !important;font-weight:500 !important;letter-spacing:0.3px !important;' +
    'background:rgba(30,30,30,0.92) !important;color:#e0e0e0 !important;' +
    'border:1px solid rgba(255,255,255,0.1) !important;border-radius:12px !important;' +
    'padding:14px 24px !important;backdrop-filter:blur(8px) !important;' +
    '-webkit-backdrop-filter:blur(8px) !important;box-shadow:0 4px 24px rgba(0,0,0,0.4) !important;}' +
    // Custom scrollbar
    '#term-scrollbar{position:fixed;right:0;top:0;width:44px;z-index:99998;pointer-events:auto;touch-action:none;}' +
    '#term-scrollbar .sb-track{position:absolute;right:2px;top:4px;bottom:4px;width:4px;' +
    'border-radius:2px;background:rgba(255,255,255,0.06);}' +
    '#term-scrollbar .sb-thumb{position:absolute;right:1px;width:6px;min-height:28px;' +
    'border-radius:3px;background:rgba(255,255,255,0.25);transition:background 0.15s,width 0.15s,right 0.15s;}' +
    '#term-scrollbar.sb-active .sb-thumb,#term-scrollbar:active .sb-thumb{' +
    'background:rgba(255,255,255,0.5);width:8px;right:0;}' +
    '#term-scrollbar .sb-touch{position:absolute;right:0;top:0;bottom:0;width:44px;}';
  document.head.appendChild(css);

  // Load Font Awesome 6 for icons
  var faLink = document.createElement('link');
  faLink.rel = 'stylesheet';
  faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  faLink.crossOrigin = 'anonymous';
  document.head.appendChild(faLink);

  // -- Bar --
  var bar = document.createElement('div');
  bar.id = 'kb-bar';
  bar.tabIndex = -1; // make focusable for keyboard dismiss trick
  bar.style.outline = 'none';

  function flash(btn) {
    btn.classList.add('kb-flash');
    setTimeout(function () { btn.classList.remove('kb-flash'); }, 120);
  }

  function mkBtn(label, handler, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    if (opts && opts.id) b.id = opts.id;
    if (opts && opts.cls) b.className = opts.cls;
    if (opts && opts.html) { b.innerHTML = label; } else { b.textContent = label; }
    var isToggle = opts && opts.toggle;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (!isToggle) flash(b);
      handler();
      if (!opts || !opts.norefocus) focusTerm();
    });
    return b;
  }

  // Buttons — esc first, arrows, sel, paste, resize (left), then modifiers, then utility (right)
  bar.appendChild(mkBtn('esc', function () { sendSeq('Escape'); }));
  bar.appendChild(mkBtn('<i class="fa-solid fa-caret-left"></i>', function () { sendSeq('ArrowLeft'); }, { cls: 'kb-icon', html: true }));
  bar.appendChild(mkBtn('<i class="fa-solid fa-caret-right"></i>', function () { sendSeq('ArrowRight'); }, { cls: 'kb-icon', html: true }));
  bar.appendChild(mkBtn('<i class="fa-solid fa-caret-up"></i>', function () { sendSeq('ArrowUp'); }, { cls: 'kb-icon', html: true }));
  bar.appendChild(mkBtn('<i class="fa-solid fa-caret-down"></i>', function () { sendSeq('ArrowDown'); }, { cls: 'kb-icon', html: true }));
  bar.appendChild(mkBtn('<i class="fa-solid fa-i-cursor"></i>', function () { selMode ? disableSelMode() : enableSelMode(); }, { id: 'kb-sel', cls: 'kb-icon', toggle: true, norefocus: true, html: true }));
  var cpBtn = mkBtn('<i class="fa-regular fa-copy"></i>', copySelection, { id: 'kb-copy', cls: 'kb-icon', html: true });
  cpBtn.style.display = 'none';
  bar.appendChild(cpBtn);
  bar.appendChild(mkBtn('<i class="fa-solid fa-clipboard"></i>', function () {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (text) { sendData(text); showToast('Pasted!'); }
      }, function () { fallbackPaste(); });
    } else {
      fallbackPaste();
    }
  }, { cls: 'kb-icon', html: true }));
  // Resize handle — next to paste button, highlights while dragging
  var resizeBtn = mkBtn('<i class="fa-solid fa-up-down"></i>', function () {}, { id: 'kb-resize', cls: 'kb-resize', html: true });
  resizeBtn.addEventListener('touchstart', onResizeTouchStart, { passive: false });
  bar.appendChild(resizeBtn);
  bar.appendChild(mkBtn('ctrl', toggleCtrl, { id: 'kb-ctrl', toggle: true }));
  bar.appendChild(mkBtn('tab', function () { sendSeq('Tab'); }));
  bar.appendChild(mkBtn('opt', toggleOpt, { id: 'kb-opt', toggle: true }));
  // Keyboard toggle
  bar.appendChild(mkBtn('<i class="fa-regular fa-keyboard"></i>', toggleKeyboard, { id: 'kb-kbd', cls: 'kb-icon', toggle: true, norefocus: true, html: true }));

  // -- Custom scrollbar --
  var sbEl = document.createElement('div');
  sbEl.id = 'term-scrollbar';
  sbEl.innerHTML = '<div class="sb-track"></div><div class="sb-thumb"></div><div class="sb-touch"></div>';
  var sbThumb = sbEl.querySelector('.sb-thumb');
  var sbTouch = sbEl.querySelector('.sb-touch');
  var sbDragging = false;
  var sbFadeTimer = 0;

  function getScrollInfo() {
    var t = window.term;
    if (!t || !t.buffer || !t.buffer.active) return null;
    var buf = t.buffer.active;
    var totalRows = buf.baseY + t.rows;
    var viewportY = buf.viewportY;
    return { total: totalRows, viewport: t.rows, scrollTop: viewportY, maxScroll: buf.baseY };
  }

  function updateScrollbar() {
    var info = getScrollInfo();
    if (!info || info.maxScroll <= 0) {
      sbEl.style.display = 'none';
      return;
    }
    sbEl.style.display = '';
    // Calculate thumb size and position relative to the track
    var trackH = sbEl.offsetHeight - 8; // 4px top + 4px bottom padding
    var thumbRatio = Math.max(0.05, info.viewport / info.total);
    var thumbH = Math.max(28, Math.round(trackH * thumbRatio));
    var scrollRatio = info.maxScroll > 0 ? info.scrollTop / info.maxScroll : 0;
    var thumbTop = 4 + Math.round((trackH - thumbH) * scrollRatio);
    sbThumb.style.height = thumbH + 'px';
    sbThumb.style.top = thumbTop + 'px';
  }

  function scrollToRatio(ratio) {
    var t = window.term;
    if (!t || !t.buffer || !t.buffer.active) return;
    var maxScroll = t.buffer.active.baseY;
    if (maxScroll <= 0) return;
    var line = Math.round(ratio * maxScroll);
    t.scrollToLine(line);
  }

  function onSbTouchStart(e) {
    e.preventDefault();
    e.stopPropagation();
    sbDragging = true;
    sbEl.classList.add('sb-active');
    clearTimeout(sbFadeTimer);
    onSbTouchMove(e);
  }

  function onSbTouchMove(e) {
    if (!sbDragging) return;
    e.preventDefault();
    e.stopPropagation();
    var touch = e.touches[0];
    var rect = sbEl.getBoundingClientRect();
    var y = touch.clientY - rect.top - 4; // offset for track padding
    var trackH = rect.height - 8;
    var ratio = Math.max(0, Math.min(1, y / trackH));
    scrollToRatio(ratio);
    updateScrollbar();
  }

  function onSbTouchEnd(e) {
    sbDragging = false;
    sbEl.classList.remove('sb-active');
    // Fade after a moment
    sbFadeTimer = setTimeout(function () {
      // thumb returns to normal style via CSS transition
    }, 1000);
  }

  sbTouch.addEventListener('touchstart', onSbTouchStart, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (sbDragging) onSbTouchMove(e);
  }, { passive: false });
  document.addEventListener('touchend', function () {
    if (sbDragging) onSbTouchEnd();
  });

  // Update scrollbar when terminal scrolls
  function hookTermScroll() {
    var t = window.term;
    if (!t) return;
    if (t._scrollbarHooked) return;
    t._scrollbarHooked = true;
    // onScroll fires when viewport scrolls
    if (typeof t.onScroll === 'function') {
      t.onScroll(updateScrollbar);
    }
    // Also poll on lineFeed for new content
    if (typeof t.onLineFeed === 'function') {
      t.onLineFeed(updateScrollbar);
    }
    // Update on writes
    if (typeof t.onWriteParsed === 'function') {
      t.onWriteParsed(updateScrollbar);
    }
    updateScrollbar();
  }

  // -- Layout engine --
  var kbOpen = false;
  var hasHadInput = false; // true after first keyboard open; starts at 100% until then
  var fullH = window.innerHeight;

  function fitTerminal() {
    if (!window.term) return;
    try {
      var addons = window.term._addonManager && window.term._addonManager._addons;
      if (addons) {
        for (var i = 0; i < addons.length; i++) {
          if (addons[i].instance && typeof addons[i].instance.fit === 'function') {
            addons[i].instance.fit();
            return;
          }
        }
      }
    } catch (e) {}
  }

  function setHeight(h) {
    var termH = h - BAR_H;

    bar.style.display = 'flex';
    bar.style.top = (termH) + 'px';

    // Position scrollbar to match terminal height
    sbEl.style.top = '0px';
    sbEl.style.height = termH + 'px';

    document.documentElement.style.height = h + 'px';
    document.body.style.height = h + 'px';

    var xterm = document.querySelector('.xterm');
    if (xterm) {
      var el = xterm;
      while (el && el !== document.body) {
        el.style.height = termH + 'px';
        el.style.maxHeight = termH + 'px';
        el.style.overflow = 'hidden';
        el = el.parentElement;
      }
      xterm.style.height = termH + 'px';
      xterm.style.maxHeight = termH + 'px';
      var screen = xterm.querySelector('.xterm-screen');
      if (screen) {
        screen.style.height = termH + 'px';
        screen.style.maxHeight = termH + 'px';
      }
    }

    window.scrollTo(0, 0);
    clearTimeout(setHeight._t);
    setHeight._t = setTimeout(fitTerminal, 50);
  }

  function getDefaultKbHeight() {
    var dims = getCellDims();
    var rowH = dims ? dims.h : 18;
    return Math.round(21 * rowH) + BAR_H;
  }

  function updateLayout() {
    // If user set a custom height via resize handle, use that
    if (customH > 0) {
      setHeight(customH + BAR_H);
      return;
    }

    var vv = window.visualViewport;
    var visH = vv ? Math.round(vv.height) : window.innerHeight;
    if (visH > fullH) fullH = visH;

    var kbDetected = (fullH - visH) > 100;

    if (kbOpen || kbDetected) {
      hasHadInput = true;
      // If viewport detects keyboard, use that height; otherwise target 21 terminal rows
      var h = kbDetected ? visH : getDefaultKbHeight();
      setHeight(h);
    } else if (hasHadInput) {
      // After keyboard was used at least once, keep 21-row default
      setHeight(getDefaultKbHeight());
    } else {
      // Initial state: full height until first keyboard interaction
      setHeight(fullH);
    }
  }

  // Suppress iOS autocorrect
  function patchTextarea(ta) {
    if (!ta) return;
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'none');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('inputmode', 'text');
    ta.addEventListener('keydown', onTermKeydown, true);
  }

  function init() {
    document.body.appendChild(bar);
    document.body.appendChild(sbEl);

    var ta = getTextarea();
    patchTextarea(ta);
    if (ta) {
      ta.focus({ preventScroll: true });
      hookTermScroll();
    } else {
      var obs = new MutationObserver(function () {
        var ta2 = getTextarea();
        if (ta2) {
          patchTextarea(ta2);
          ta2.focus({ preventScroll: true });
          hookTermScroll();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    // Retry hooking scrollbar (term may load after textarea)
    setTimeout(hookTermScroll, 1000);
    setTimeout(hookTermScroll, 3000);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateLayout);
    }
    window.addEventListener('resize', function () {
      var h = window.innerHeight;
      if (h > fullH) fullH = h;
      updateLayout();
    });

    // Track keyboard state via focus/blur (don't reset customH)
    document.addEventListener('focusin', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('xterm-helper-textarea')) {
        kbOpen = true;
        var btn = document.getElementById('kb-kbd');
        if (btn) btn.classList.add('kb-active');
        setTimeout(updateLayout, 300);
      }
    });
    document.addEventListener('focusout', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('xterm-helper-textarea')) {
        kbOpen = false;
        var btn = document.getElementById('kb-kbd');
        if (btn) btn.classList.remove('kb-active');
        setTimeout(updateLayout, 300);
      }
    });

    // Restyle ttyd overlay messages with FA icons
    var overlayObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          var overlays = [];
          if (node.classList && node.classList.contains('xterm-overlay')) overlays.push(node);
          else if (node.querySelectorAll) overlays = node.querySelectorAll('.xterm-overlay');
          overlays.forEach(function (ov) {
            if (ov._styled) return;
            ov._styled = true;
            var text = ov.textContent || '';
            if (/reconnect/i.test(text)) {
              ov.innerHTML = '<i class="fa-solid fa-rotate-right" style="margin-right:8px;color:#3478f6;"></i>' + text;
            } else if (/disconnect/i.test(text)) {
              ov.innerHTML = '<i class="fa-solid fa-link-slash" style="margin-right:8px;color:#ff6b6b;"></i>' + text;
            } else if (/connect/i.test(text)) {
              ov.innerHTML = '<i class="fa-solid fa-plug" style="margin-right:8px;color:#4cd964;"></i>' + text;
            }
          });
        });
      });
    });
    overlayObs.observe(document.body, { childList: true, subtree: true });

    // Prevent iframe/page scrolling — only allow scrolling inside terminal, keybar, and scrollbar
    document.addEventListener('touchmove', function (e) {
      if (sbDragging) return; // allow scrollbar drag
      var el = e.target;
      while (el && el !== document.body) {
        if (el.id === 'kb-bar') return;
        if (el.id === 'term-scrollbar') return;
        if (el.classList && (el.classList.contains('xterm-screen') || el.classList.contains('xterm'))) return;
        el = el.parentElement;
      }
      e.preventDefault();
    }, { passive: false });

    // Start with keyboard active and 21-row height
    kbOpen = true;
    hasHadInput = true;
    var kbBtn = document.getElementById('kb-kbd');
    if (kbBtn) kbBtn.classList.add('kb-active');
    updateLayout();

    // iOS requires a user gesture to show keyboard in WKWebView.
    // Try programmatic focus first (works on some devices), then
    // add a one-time touch listener as fallback for iOS.
    focusTerm();
    // Retry focus after textarea might appear (ttyd loads async)
    setTimeout(focusTerm, 500);
    setTimeout(focusTerm, 1500);

    // Fallback: first touch anywhere activates the keyboard
    function onFirstTouch(e) {
      // Don't steal focus from keybar buttons
      var el = e.target;
      while (el) {
        if (el.id === 'kb-bar') return;
        el = el.parentElement;
      }
      focusTerm();
      document.removeEventListener('touchstart', onFirstTouch, true);
    }
    document.addEventListener('touchstart', onFirstTouch, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('focus', focusTerm);
})();
