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
  var barHidden = false;
  var selMode = false;
  var BAR_H = 36;
  var fullH = window.innerHeight;

  function getTextarea() {
    return document.querySelector('.xterm-helper-textarea');
  }

  function focusTerm() {
    var ta = getTextarea();
    if (ta) ta.focus({ preventScroll: true });
  }

  function blurTerm() {
    var ta = getTextarea();
    if (ta) ta.blur();
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

  function onTermKeydown(e) {
    if (!ctrlActive) return;
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      sendCtrlChar(e.key);
    }
  }

  // -- Selection mode --
  var selStartCell = null;
  var selOverlay = null;

  function getCellDims() {
    var t = window.term;
    if (!t || !t._core) return null;
    var core = t._core;
    // Try render service dimensions
    var rs = core._renderService;
    if (rs && rs.dimensions) {
      var d = rs.dimensions;
      // Try css cell dimensions first, fall back to actual
      var w = (d.css && d.css.cell && d.css.cell.width) || d.actualCellWidth;
      var h = (d.css && d.css.cell && d.css.cell.height) || d.actualCellHeight;
      if (w && h) return { w: w, h: h };
    }
    // Fallback: calculate from screen element size
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
    // Normalize: ensure start is before end
    var r1 = start.row, c1 = start.col, r2 = end.row, c2 = end.col;
    if (r1 > r2 || (r1 === r2 && c1 > c2)) {
      var tmp = r1; r1 = r2; r2 = tmp;
      tmp = c1; c1 = c2; c2 = tmp;
    }
    // Calculate length: from (c1,r1) to (c2,r2)
    var len;
    if (r1 === r2) {
      len = c2 - c1 + 1;
    } else {
      len = (t.cols - c1) + (r2 - r1 - 1) * t.cols + (c2 + 1);
    }
    t.select(c1, r1 + t.buffer.active.viewportY, len);
  }

  function createSelOverlay() {
    if (selOverlay) return selOverlay;
    selOverlay = document.createElement('div');
    selOverlay.id = 'kb-sel-overlay';
    selOverlay.style.cssText =
      'position:absolute;top:0;left:0;right:0;bottom:0;z-index:9999;' +
      'cursor:crosshair;touch-action:none;';
    return selOverlay;
  }

  function enableSelMode() {
    selMode = true;
    var btn = document.getElementById('kb-sel');
    if (btn) btn.classList.add('kb-active');
    // Show copy button
    var copyBtn = document.getElementById('kb-copy');
    if (copyBtn) copyBtn.style.display = '';
    // Place transparent overlay over the terminal to capture touches
    var screen = document.querySelector('.xterm-screen');
    if (screen && screen.parentElement) {
      var overlay = createSelOverlay();
      screen.parentElement.style.position = 'relative';
      screen.parentElement.appendChild(overlay);

      overlay.addEventListener('touchstart', onSelTouchStart, { passive: false });
      overlay.addEventListener('touchmove', onSelTouchMove, { passive: false });
      overlay.addEventListener('touchend', onSelTouchEnd, { passive: false });
    }
  }

  function disableSelMode() {
    selMode = false;
    selStartCell = null;
    var btn = document.getElementById('kb-sel');
    if (btn) btn.classList.remove('kb-active');
    var copyBtn = document.getElementById('kb-copy');
    if (copyBtn) copyBtn.style.display = 'none';
    // Remove overlay
    if (selOverlay && selOverlay.parentElement) {
      selOverlay.removeEventListener('touchstart', onSelTouchStart);
      selOverlay.removeEventListener('touchmove', onSelTouchMove);
      selOverlay.removeEventListener('touchend', onSelTouchEnd);
      selOverlay.parentElement.removeChild(selOverlay);
    }
    // Clear selection
    if (window.term) window.term.clearSelection();
  }

  function toggleSelMode() {
    if (selMode) disableSelMode();
    else enableSelMode();
  }

  function onSelTouchStart(e) {
    e.preventDefault();
    var cell = touchToCell(e.touches[0]);
    if (cell) selStartCell = cell;
  }

  function onSelTouchMove(e) {
    e.preventDefault();
    if (!selStartCell) return;
    var cell = touchToCell(e.touches[0]);
    if (cell) selectRange(selStartCell, cell);
  }

  function onSelTouchEnd(e) {
    e.preventDefault();
    // Selection stays highlighted — user can tap copy
  }

  function copySelection() {
    var t = window.term;
    if (!t) return;
    var text = t.getSelection();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Copied!');
      }, function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copied!'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function showToast(msg) {
    var el = document.getElementById('kb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kb-toast';
      el.style.cssText =
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'z-index:999999;padding:8px 20px;border-radius:8px;' +
        'background:rgba(0,0,0,0.8);color:#fff;font-size:14px;' +
        'font-family:-apple-system,system-ui,sans-serif;pointer-events:none;' +
        'transition:opacity 0.3s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.style.opacity = '0'; }, 1200);
  }

  // -- CSS --
  var css = document.createElement('style');
  css.textContent =
    'html,body{margin:0;padding:0;overflow:hidden !important;height:100%;}' +
    '#kb-bar{position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
    'display:flex;align-items:center;height:' + BAR_H + 'px;padding:0 2px;' +
    'background:#1a1a1a;border-top:1px solid #333;gap:1px;' +
    'user-select:none;-webkit-user-select:none;font-family:-apple-system,system-ui,sans-serif;}' +
    '#kb-bar button{flex:0 0 auto;height:30px;min-width:36px;padding:0 8px;margin:0;' +
    'border:0;border-radius:5px;background:#2d2d2d;color:#e0e0e0;' +
    'font-size:13px;font-weight:500;line-height:30px;text-align:center;' +
    'touch-action:manipulation;-webkit-tap-highlight-color:transparent;}' +
    '#kb-bar button.kb-flash{background:#555;color:#fff;transition:none;}' +
    '#kb-bar button.kb-active{background:#3478f6;color:#fff;}' +
    '#kb-bar button.kb-icon{font-size:16px;min-width:38px;}' +
    '#kb-bar .kb-sep{flex:1 1 0;min-width:2px;}' +
    '#kb-hide{position:fixed;right:8px;bottom:8px;z-index:99998;' +
    'display:none;width:40px;height:40px;border:0;border-radius:50%;' +
    'background:rgba(30,30,30,0.9);color:#fff;font-size:18px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.4);touch-action:manipulation;}';
  document.head.appendChild(css);

  // -- Bar --
  var bar = document.createElement('div');
  bar.id = 'kb-bar';

  var showBtn = document.createElement('button');
  showBtn.id = 'kb-hide';
  showBtn.textContent = '\u2328';

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

  function mkSep() {
    var s = document.createElement('span');
    s.className = 'kb-sep';
    return s;
  }

  // Buttons - row 1: ctrl, esc, tab, chars, sel, copy | arrows | dismiss, hide
  bar.appendChild(mkBtn('ctrl', toggleCtrl, { id: 'kb-ctrl', toggle: true }));
  bar.appendChild(mkBtn('esc', function () { sendSeq('Escape'); }));
  bar.appendChild(mkBtn('tab', function () { sendSeq('Tab'); }));
  bar.appendChild(mkBtn('|', function () { sendData('|'); clearCtrl(); }));
  bar.appendChild(mkBtn('-', function () { sendData('-'); clearCtrl(); }));
  bar.appendChild(mkBtn('/', function () { sendData('/'); clearCtrl(); }));
  bar.appendChild(mkBtn('sel', toggleSelMode, { id: 'kb-sel', toggle: true, norefocus: true }));
  var copyBtn = mkBtn('cp', function () { copySelection(); }, { id: 'kb-copy' });
  copyBtn.style.display = 'none';
  bar.appendChild(copyBtn);
  bar.appendChild(mkSep());
  bar.appendChild(mkBtn('\u25C0', function () { sendSeq('ArrowLeft'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B6', function () { sendSeq('ArrowRight'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B2', function () { sendSeq('ArrowUp'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25BC', function () { sendSeq('ArrowDown'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkSep());
  bar.appendChild(mkBtn('\u2B07', function () { blurTerm(); }, { cls: 'kb-icon', norefocus: true }));
  bar.appendChild(mkBtn('\u2328', function () {
    barHidden = true;
    updateLayout();
  }, { cls: 'kb-icon' }));

  showBtn.addEventListener('click', function () {
    barHidden = false;
    updateLayout();
    focusTerm();
  });

  // -- Layout engine --
  function getVisibleHeight() {
    if (window.visualViewport) return Math.round(window.visualViewport.height);
    return window.innerHeight;
  }

  function fitTerminal() {
    if (!window.term) return;
    try {
      if (window.term._addonManager) {
        var addons = window.term._addonManager._addons;
        for (var i = 0; i < addons.length; i++) {
          if (addons[i].instance && typeof addons[i].instance.fit === 'function') {
            addons[i].instance.fit();
            return;
          }
        }
      }
    } catch (e) {}
    try { window.term.refresh(0, window.term.rows - 1); } catch (e) {}
  }

  function updateLayout() {
    var h = getVisibleHeight();
    if (h > fullH) fullH = h;

    var barActive = !barHidden;
    var barSize = barActive ? BAR_H : 0;
    var termH = h - barSize;

    if (barActive) {
      bar.style.display = 'flex';
      showBtn.style.display = 'none';
    } else {
      bar.style.display = 'none';
      showBtn.style.display = 'block';
    }

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
    clearTimeout(updateLayout._fitTimer);
    updateLayout._fitTimer = setTimeout(fitTerminal, 50);
  }

  // Suppress iOS autocorrect
  function patchTextarea(ta) {
    if (!ta) return;
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'none');
    ta.setAttribute('spellcheck', 'false');
    ta.addEventListener('keydown', onTermKeydown, true);
  }

  function init() {
    document.body.appendChild(bar);
    document.body.appendChild(showBtn);

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
      window.visualViewport.addEventListener('scroll', function () { window.scrollTo(0, 0); });
    }
    window.addEventListener('resize', function () {
      var h = getVisibleHeight();
      if (h > fullH) fullH = h;
      updateLayout();
    });

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
