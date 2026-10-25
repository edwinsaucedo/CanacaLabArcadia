'use strict';
// Entrega del foco al emulador. Con SDL3 y Windows.Gaming.Input, los controles Xbox solo mandan botones a la
// ventana que tiene el foco: si CanacaLabArcadia se minimiza antes de que el emulador abra su ventana, Windows
// le da el foco a otra (por ejemplo la de Claude) y el juego no recibe el control.
// Aqui: se permite al emulador tomar el foco, se espera a que su ventana aparezca y se le da el foco a ella;
// recien entonces se minimiza CanacaLabArcadia.

let cached;

function loadUser32() {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') return cached;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const EnumProc = koffi.proto('bool __stdcall ArcEnumWindowsProc(void *hwnd, intptr_t lParam)');
    const fns = {
      EnumWindows: user32.func('bool __stdcall EnumWindows(ArcEnumWindowsProc *proc, intptr_t lParam)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(void *hwnd)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hwnd)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(void *hwnd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(void *hwnd, int nCmdShow)'),
      AllowSetForegroundWindow: user32.func('bool __stdcall AllowSetForegroundWindow(uint32 dwProcessId)'),
      PostMessageW: user32.func('bool __stdcall PostMessageW(void *hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam)')
    };
    cached = {
      // Cualquier proceso (el emulador) puede tomar el foco mientras CanacaLabArcadia lo tiene.
      allowForeground() {
        try { return fns.AllowSetForegroundWindow(0xFFFFFFFF); } catch { return false; }
      },
      // Primera ventana visible y con titulo del proceso pid.
      findWindow(pid) {
        let found = null;
        try {
          fns.EnumWindows((hwnd) => {
            const out = [0];
            fns.GetWindowThreadProcessId(hwnd, out);
            if (out[0] === pid && fns.IsWindowVisible(hwnd) && fns.GetWindowTextLengthW(hwnd) > 0) {
              found = hwnd;
              return false;
            }
            return true;
          }, 0);
        } catch { return null; }
        return found;
      },
      // Pide a todas las ventanas del proceso que se cierren (como la X de la ventana).
      closeWindows(pid) {
        let n = 0;
        try {
          fns.EnumWindows((hwnd) => {
            const out = [0];
            fns.GetWindowThreadProcessId(hwnd, out);
            if (out[0] === pid) { fns.PostMessageW(hwnd, 0x0010, 0, 0); n++; }
            return true;
          }, 0);
        } catch { return 0; }
        return n;
      },
      focus(hwnd) {
        try {
          fns.ShowWindow(hwnd, 5); // SW_SHOW
          fns.BringWindowToTop(hwnd);
          return fns.SetForegroundWindow(hwnd);
        } catch { return false; }
      }
    };
  } catch {
    cached = null;
  }
  return cached;
}

// Espera la ventana del emulador (hasta timeoutMs), le da el foco y luego llama done().
// Sin acceso a Windows (pruebas, otro sistema) solo espera fallbackMs y llama done().
function handOffFocus({ pid, api = loadUser32(), isRunning = () => true, done, intervalMs = 250, timeoutMs = 12000, settleMs = 400, fallbackMs = 600 }) {
  let finished = false;
  const finish = (how) => {
    if (finished) return;
    finished = true;
    try { done(how); } catch { /* nada */ }
  };
  if (!api || !pid) {
    setTimeout(() => finish('sin-win32'), fallbackMs);
    return;
  }
  const start = Date.now();
  const tick = () => {
    if (finished) return;
    if (!isRunning()) return finish('termino');
    const hwnd = api.findWindow(pid);
    if (hwnd) {
      // La ventana ya existe: un momento para que termine de crearse (pantalla completa) y se le da el foco.
      setTimeout(() => {
        if (!isRunning()) return finish('termino');
        api.focus(api.findWindow(pid) || hwnd);
        finish('ventana');
      }, settleMs);
      return;
    }
    if (Date.now() - start >= timeoutMs) return finish('tiempo');
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
}

module.exports = { loadUser32, handOffFocus };
