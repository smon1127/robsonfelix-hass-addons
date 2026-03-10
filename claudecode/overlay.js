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
      ta.blur();
      kbOpen = false;
    } else {
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
      selOverlay.addEventListener('touchstart', onSelTouch, { passive: false });
      selOverlay.addEventListener('touchmove', onSelTouch, { passive: false });
    }
  }

  function disableSelMode() {
    selMode = false;
    selStartCell = null;
    document.getElementById('kb-sel').classList.remove('kb-active');
    document.getElementById('kb-copy').style.display = 'none';
    if (selOverlay && selOverlay.parentElement) {
      selOverlay.removeEventListener('touchstart', onSelTouch);
      selOverlay.removeEventListener('touchmove', onSelTouch);
      selOverlay.parentElement.removeChild(selOverlay);
    }
    if (window.term) window.term.clearSelection();
  }

  function onSelTouch(e) {
    e.preventDefault();
    var cell = touchToCell(e.touches[0]);
    if (!cell) return;
    if (e.type === 'touchstart') selStartCell = cell;
    if (selStartCell) selectRange(selStartCell, cell);
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

    function onMove(ev) {
      ev.preventDefault();
      var dy = ev.touches[0].clientY - startY;
      var newTermH = Math.max(100, Math.min(startBarTop + dy, fullH - BAR_H));
      customH = newTermH;
      setHeight(newTermH + BAR_H);
    }
    function onEnd() {
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
    '#kb-bar button.kb-icon{font-size:18px;min-width:44px;padding:0 10px;}' +
    '#kb-bar button.kb-resize{cursor:ns-resize;font-size:18px;min-width:44px;padding:0 10px;' +
    'background:#333;touch-action:none;}';
  document.head.appendChild(css);

  // -- Bar --
  var bar = document.createElement('div');
  bar.id = 'kb-bar';

  function flash(btn) {
    btn.classList.add('kb-flash');
    setTimeout(function () { btn.classList.remove('kb-flash'); }, 120);
  }

  function mkBtn(label, handler, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    if (opts && opts.id) b.id = opts.id;
    if (opts && opts.cls) b.className = opts.cls;
    b.textContent = label;
    var isToggle = opts && opts.toggle;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (!isToggle) flash(b);
      handler();
      if (!opts || !opts.norefocus) focusTerm();
    });
    return b;
  }

  // Buttons
  bar.appendChild(mkBtn('ctrl', toggleCtrl, { id: 'kb-ctrl', toggle: true }));
  bar.appendChild(mkBtn('esc', function () { sendSeq('Escape'); }));
  bar.appendChild(mkBtn('tab', function () { sendSeq('Tab'); }));
  bar.appendChild(mkBtn('opt', toggleOpt, { id: 'kb-opt', toggle: true }));
  bar.appendChild(mkBtn('sel', function () { selMode ? disableSelMode() : enableSelMode(); }, { id: 'kb-sel', toggle: true, norefocus: true }));
  var cpBtn = mkBtn('cp', copySelection, { id: 'kb-copy' });
  cpBtn.style.display = 'none';
  bar.appendChild(cpBtn);
  bar.appendChild(mkBtn('paste', function () {
    // Try modern Clipboard API first (requires HTTPS/secure context)
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (text) { sendData(text); showToast('Pasted!'); }
      }, function () { fallbackPaste(); });
    } else {
      fallbackPaste();
    }
  }));
  bar.appendChild(mkBtn('\u25C0', function () { sendSeq('ArrowLeft'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B6', function () { sendSeq('ArrowRight'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B2', function () { sendSeq('ArrowUp'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25BC', function () { sendSeq('ArrowDown'); }, { cls: 'kb-icon' }));
  // Keyboard toggle
  bar.appendChild(mkBtn('\u2328', toggleKeyboard, { id: 'kb-kbd', cls: 'kb-icon', toggle: true, norefocus: true }));
  // Resize handle — drag up/down to adjust terminal height
  var resizeBtn = mkBtn('\u2195', function () {}, { cls: 'kb-resize' });
  resizeBtn.addEventListener('touchstart', onResizeTouchStart, { passive: false });
  bar.appendChild(resizeBtn);
  // Refresh repos + update add-on
  bar.appendChild(mkBtn('\u21BB', function () {
    showToast('Checking for updates...');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/refresh-update');
    xhr.onload = function () {
      try {
        var r = JSON.parse(xhr.responseText);
        if (r.status === 'current') {
          showToast('\u2713 v' + (r.version || '?') + ' is latest');
        } else if (r.status === 'updating') {
          showToast('\u2B06 Updating to v' + r.to + '...');
        } else {
          showToast(r.message || 'Error');
        }
      } catch (e) { showToast('Error: ' + xhr.statusText); }
    };
    xhr.onerror = function () { showToast('Network error'); };
    xhr.send();
  }, { cls: 'kb-icon', norefocus: true }));

  // -- Layout engine --
  var kbOpen = false;
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
      var h = kbDetected ? visH : Math.round(fullH * 0.50);
      setHeight(h);
    } else {
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

    var ta = getTextarea();
    patchTextarea(ta);
    if (!ta) {
      var obs = new MutationObserver(function () {
        var ta2 = getTextarea();
        if (ta2) {
          patchTextarea(ta2);
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }

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

    // Prevent iframe/page scrolling — only allow scrolling inside terminal and keybar
    document.addEventListener('touchmove', function (e) {
      var el = e.target;
      while (el && el !== document.body) {
        if (el.id === 'kb-bar') return; // allow keybar horizontal scroll
        if (el.classList && (el.classList.contains('xterm-screen') || el.classList.contains('xterm'))) return;
        el = el.parentElement;
      }
      e.preventDefault();
    }, { passive: false });

    updateLayout();
    focusTerm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('focus', focusTerm);
})();
