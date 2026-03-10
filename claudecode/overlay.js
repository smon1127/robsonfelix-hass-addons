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
  var BAR_H = 36;

  function getTextarea() {
    return document.querySelector('.xterm-helper-textarea');
  }

  function focusTerm() {
    var ta = getTextarea();
    if (ta) ta.focus({ preventScroll: true });
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

  // Intercept regular key input when ctrl is latched
  function onTermKeydown(e) {
    if (!ctrlActive) return;
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      sendCtrlChar(e.key);
    }
  }

  var css = document.createElement('style');
  css.textContent =
    'html,body{height:100%;overflow:hidden;margin:0;padding:0;}' +
    '#kb-bar{position:absolute;left:0;right:0;z-index:99999;' +
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
    '#kb-hide{position:absolute;right:8px;z-index:99998;' +
    'display:none;width:40px;height:40px;border:0;border-radius:50%;' +
    'background:rgba(30,30,30,0.9);color:#fff;font-size:18px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.4);touch-action:manipulation;}';
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = 'kb-bar';

  var showBtn = document.createElement('button');
  showBtn.id = 'kb-hide';
  showBtn.textContent = '\u2328';

  var barHidden = false;

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
      focusTerm();
    });
    return b;
  }

  function mkSep() {
    var s = document.createElement('span');
    s.className = 'kb-sep';
    return s;
  }

  // Buttons
  bar.appendChild(mkBtn('ctrl', toggleCtrl, { id: 'kb-ctrl', toggle: true }));
  bar.appendChild(mkBtn('esc', function () { sendSeq('Escape'); }));
  bar.appendChild(mkBtn('tab', function () { sendSeq('Tab'); }));
  bar.appendChild(mkBtn('|', function () { sendData('|'); clearCtrl(); }));
  bar.appendChild(mkBtn('-', function () { sendData('-'); clearCtrl(); }));
  bar.appendChild(mkBtn('/', function () { sendData('/'); clearCtrl(); }));
  bar.appendChild(mkSep());
  bar.appendChild(mkBtn('\u25C0', function () { sendSeq('ArrowLeft'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B6', function () { sendSeq('ArrowRight'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25B2', function () { sendSeq('ArrowUp'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkBtn('\u25BC', function () { sendSeq('ArrowDown'); }, { cls: 'kb-icon' }));
  bar.appendChild(mkSep());
  bar.appendChild(mkBtn('\u2328', function () {
    barHidden = true;
    updateLayout();
  }, { cls: 'kb-icon' }));

  showBtn.addEventListener('click', function () {
    barHidden = false;
    updateLayout();
    focusTerm();
  });

  // Use visualViewport API to position bar and resize terminal
  function updateLayout() {
    var vv = window.visualViewport;
    var vh = vv ? vv.height : window.innerHeight;
    var vTop = vv ? vv.offsetTop : 0;

    // Find xterm container and resize it
    var xtermEl = document.querySelector('.xterm');
    var termContainer = xtermEl ? xtermEl.parentElement : null;

    if (barHidden) {
      bar.style.display = 'none';
      showBtn.style.display = 'block';
      showBtn.style.top = (vTop + vh - 48) + 'px';
      if (termContainer) termContainer.style.height = vh + 'px';
      if (xtermEl) xtermEl.style.height = vh + 'px';
    } else {
      bar.style.display = 'flex';
      showBtn.style.display = 'none';
      bar.style.top = (vTop + vh - BAR_H) + 'px';
      var termH = vh - BAR_H;
      if (termContainer) termContainer.style.height = termH + 'px';
      if (xtermEl) xtermEl.style.height = termH + 'px';
    }

    // Tell xterm to refit
    if (window.term && window.term._core) {
      try {
        var renderer = window.term._core._renderService;
        if (renderer) renderer.onResize(window.term.cols, window.term.rows);
      } catch (e) {}
      // Also try the fit addon if available
      try {
        if (window.term._addonManager) {
          var addons = window.term._addonManager._addons;
          for (var i = 0; i < addons.length; i++) {
            if (addons[i].instance && typeof addons[i].instance.fit === 'function') {
              addons[i].instance.fit();
            }
          }
        }
      } catch (e) {}
    }
  }

  // Suppress iOS form accessory bar and autocorrect
  function patchTextarea(ta) {
    if (!ta) return;
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'none');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('enterkeyhint', '');
    ta.style.webkitUserModify = 'read-write-plaintext-only';
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

    // Listen to visualViewport changes (keyboard open/close, resize)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateLayout);
      window.visualViewport.addEventListener('scroll', updateLayout);
    }
    window.addEventListener('resize', updateLayout);

    // Initial layout
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
