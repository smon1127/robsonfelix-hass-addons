(function () {
  const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!isTouch) return;

  const SEQUENCES = {
    Escape: '\x1b',
    Tab: '\t',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
    Home: '\x1b[H',
    End: '\x1b[F',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~'
  };

  let ctrlLatch = false;
  let altLatch = false;

  function getTextarea() {
    return document.querySelector('.xterm-helper-textarea');
  }

  function focusTerminal() {
    const textarea = getTextarea();
    if (textarea) textarea.focus({ preventScroll: true });
  }

  function sendData(data) {
    const term = window.term;
    try {
      if (term && term._core && term._core.coreService && typeof term._core.coreService.triggerDataEvent === 'function') {
        term._core.coreService.triggerDataEvent(data, true);
        return true;
      }
      if (term && term._core && term._core._coreService && typeof term._core._coreService.triggerDataEvent === 'function') {
        term._core._coreService.triggerDataEvent(data, true);
        return true;
      }
      if (term && typeof term.paste === 'function') {
        term.paste(data);
        return true;
      }
    } catch (err) {
      console.warn('Floating keybar send failed', err);
    }
    return false;
  }

  function sendKey(key, code, keyCode) {
    focusTerminal();
    const textarea = getTextarea();
    if (!textarea) return;

    const event = new KeyboardEvent('keydown', {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      ctrlKey: ctrlLatch,
      altKey: altLatch,
    });
    textarea.dispatchEvent(event);
  }

  function sendSpecial(name, fallbackKey, fallbackCode, fallbackKeyCode) {
    if (!sendData(SEQUENCES[name])) {
      sendKey(fallbackKey, fallbackCode, fallbackKeyCode);
    }
    ctrlLatch = false;
    altLatch = false;
    syncLatchButtons();
  }

  function sendCtrlChar(ch) {
    const upper = ch.toUpperCase();
    const code = upper.charCodeAt(0);
    if (code >= 64 && code <= 95) {
      sendData(String.fromCharCode(code - 64));
    }
    ctrlLatch = false;
    altLatch = false;
    syncLatchButtons();
  }

  function sendLiteral(text) {
    if (ctrlLatch && text.length === 1 && /[a-z]/i.test(text)) {
      sendCtrlChar(text);
      return;
    }
    if (altLatch) {
      sendData('\x1b' + text);
      altLatch = false;
      ctrlLatch = false;
      syncLatchButtons();
      return;
    }
    sendData(text);
    ctrlLatch = false;
    syncLatchButtons();
  }

  const style = document.createElement('style');
  style.textContent = `
    #ha-floating-keybar {
      position: fixed;
      left: 10px;
      right: 10px;
      bottom: max(10px, env(safe-area-inset-bottom));
      z-index: 9999;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      padding: 8px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      user-select: none;
      -webkit-user-select: none;
    }
    #ha-floating-keybar button {
      appearance: none;
      border: 0;
      border-radius: 10px;
      min-height: 42px;
      padding: 0 8px;
      background: rgba(148, 163, 184, 0.18);
      color: #f8fafc;
      font-size: 14px;
      font-weight: 600;
    }
    #ha-floating-keybar button.active {
      background: rgba(59, 130, 246, 0.75);
    }
    #ha-floating-keybar button.wide {
      grid-column: span 2;
    }
    #ha-floating-keybar button.hide {
      background: rgba(239, 68, 68, 0.8);
    }
    body { padding-bottom: 120px; }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'ha-floating-keybar';

  const buttons = [
    ['Esc', () => sendSpecial('Escape', 'Escape', 'Escape', 27)],
    ['Tab', () => sendSpecial('Tab', 'Tab', 'Tab', 9)],
    ['Ctrl', () => { ctrlLatch = !ctrlLatch; syncLatchButtons(); }, 'latch ctrl'],
    ['Alt', () => { altLatch = !altLatch; syncLatchButtons(); }, 'latch alt'],
    ['Hide', () => { bar.style.display = 'none'; showButton.style.display = 'block'; }, 'hide'],
    ['←', () => sendSpecial('ArrowLeft', 'ArrowLeft', 'ArrowLeft', 37)],
    ['↑', () => sendSpecial('ArrowUp', 'ArrowUp', 'ArrowUp', 38)],
    ['↓', () => sendSpecial('ArrowDown', 'ArrowDown', 'ArrowDown', 40)],
    ['→', () => sendSpecial('ArrowRight', 'ArrowRight', 'ArrowRight', 39)],
    ['PgUp', () => sendSpecial('PageUp', 'PageUp', 'PageUp', 33)],
    ['PgDn', () => sendSpecial('PageDown', 'PageDown', 'PageDown', 34)],
    ['Home', () => sendSpecial('Home', 'Home', 'Home', 36)],
    ['End', () => sendSpecial('End', 'End', 'End', 35)],
    ['Ctrl+C', () => sendData('\x03')],
    ['Ctrl+D', () => sendData('\x04')],
  ];

  const latchButtons = {};
  function syncLatchButtons() {
    if (latchButtons.Ctrl) latchButtons.Ctrl.classList.toggle('active', ctrlLatch);
    if (latchButtons.Alt) latchButtons.Alt.classList.toggle('active', altLatch);
  }

  buttons.forEach(([label, handler, kind]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (kind === 'hide') button.classList.add('hide');
    if (kind && kind.startsWith('latch')) latchButtons[label] = button;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      handler();
      focusTerminal();
    });
    bar.appendChild(button);
  });

  const showButton = document.createElement('button');
  showButton.type = 'button';
  showButton.textContent = '⌨︎';
  showButton.style.cssText = `
    position: fixed;
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 9999;
    display: none;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.88);
    color: #fff;
    font-size: 20px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  `;
  showButton.addEventListener('click', () => {
    bar.style.display = 'grid';
    showButton.style.display = 'none';
    focusTerminal();
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(bar);
    document.body.appendChild(showButton);
    focusTerminal();
  });

  window.addEventListener('focus', focusTerminal);
  window.addEventListener('resize', focusTerminal);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Unidentified' && event.target === getTextarea()) {
      focusTerminal();
    }
  });

  window.haFloatingKeybar = {
    sendLiteral,
    sendData,
  };
})();
