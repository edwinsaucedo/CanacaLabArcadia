'use strict';
// Combinacion universal para SALIR de cualquier juego: mantener View (Select) + Menu (Start).
// Funciona aunque el emulador tenga el foco, porque lee el control directo de Windows (XInput),
// no desde la ventana de CanacaLabArcadia. El control integrado de la ROG Ally X es XInput.
const { EventEmitter } = require('events');

const BTN = {
  DPAD_UP: 0x0001, DPAD_DOWN: 0x0002, DPAD_LEFT: 0x0004, DPAD_RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LTHUMB: 0x0040, RTHUMB: 0x0080,
  LB: 0x0100, RB: 0x0200, A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000
};

let cachedReader;

function loadXInput() {
  if (cachedReader !== undefined) return cachedReader;
  cachedReader = loadXInputOnce();
  return cachedReader;
}

function loadXInputOnce() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    let lib = null;
    for (const dll of ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']) {
      try {
        lib = koffi.load(dll);
        break;
      } catch { /* probar la siguiente */ }
    }
    if (!lib) return null;
    const GAMEPAD = koffi.struct('ARC_XINPUT_GAMEPAD', {
      wButtons: 'uint16', bLeftTrigger: 'uint8', bRightTrigger: 'uint8',
      sThumbLX: 'int16', sThumbLY: 'int16', sThumbRX: 'int16', sThumbRY: 'int16'
    });
    const STATE = koffi.struct('ARC_XINPUT_STATE', { dwPacketNumber: 'uint32', Gamepad: GAMEPAD });
    const getState = lib.func('uint32 __stdcall XInputGetState(uint32 dwUserIndex, _Out_ ARC_XINPUT_STATE *pState)');
    const reader = (index) => {
      const st = {};
      return getState(index, st) === 0 ? st.Gamepad : null;
    };
    // VID/PID de cada control con XInputGetCapabilitiesEx (ordinal 108 de xinput1_4.dll, el mismo que usa SDL).
    // Sirve para decirle a RetroArch exactamente que control es el jugador 1.
    try {
      const VIB = koffi.struct('ARC_XINPUT_VIBRATION', { wLeftMotorSpeed: 'uint16', wRightMotorSpeed: 'uint16' });
      const CAPS = koffi.struct('ARC_XINPUT_CAPABILITIES', { Type: 'uint8', SubType: 'uint8', Flags: 'uint16', Gamepad: GAMEPAD, Vibration: VIB });
      const CAPS_EX = koffi.struct('ARC_XINPUT_CAPABILITIES_EX', {
        Capabilities: CAPS, VendorId: 'uint16', ProductId: 'uint16', ProductVersion: 'uint16', unk1: 'uint16', unk2: 'uint32'
      });
      const capsEx = lib.func('__stdcall', 108, 'uint32', ['uint32', 'uint32', 'uint32', koffi.out(koffi.pointer(CAPS_EX))]);
      reader.identity = (index) => {
        const c = {};
        if (capsEx(1, index, 0, c) !== 0 || !c.VendorId) return null;
        return { vid: c.VendorId, pid: c.ProductId, ver: c.ProductVersion || 0, sub: (c.Capabilities && c.Capabilities.SubType) || 1 };
      };
    } catch { /* Windows sin xinput1_4: solo se pierde la identificacion del control */ }
    return reader;
  } catch {
    return null;
  }
}

class ComboWatcher extends EventEmitter {
  constructor({ holdMs = 1200, combo = BTN.BACK | BTN.START, reader } = {}) {
    super();
    this.holdMs = holdMs;
    this.combo = combo;
    this.read = reader === undefined ? loadXInput() : reader;
    this.timer = null;
    this.heldSince = 0;
    this.fired = false;
  }

  get available() {
    return typeof this.read === 'function';
  }

  // Devuelve los botones presionados en cualquiera de los 4 controles.
  pressed() {
    let buttons = 0;
    for (let i = 0; i < 4; i++) {
      const pad = this.read(i);
      if (pad) buttons |= pad.wButtons;
    }
    return buttons;
  }

  tick(now = Date.now()) {
    const b = this.pressed();
    const holding = (b & this.combo) === this.combo;
    if (!holding) {
      this.heldSince = 0;
      this.fired = false;
      return false;
    }
    if (!this.heldSince) this.heldSince = now;
    if (!this.fired && now - this.heldSince >= this.holdMs) {
      this.fired = true;
      this.emit('combo');
      return true;
    }
    return false;
  }

  start() {
    if (!this.available || this.timer) return false;
    this.heldSince = 0;
    this.fired = false;
    this.timer = setInterval(() => {
      try { this.tick(); } catch { /* control desconectado */ }
    }, 50);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// Recuerda cual de los 4 controles XInput se uso por ultimo (botones, gatillos o sticks).
// Asi, el control con el que abres un juego es el jugador 1, aunque la Ally X tenga su control integrado
// y conectes otro de Xbox (que Windows pone como control 2).
class PadTracker {
  constructor({ reader, intervalMs = 120 } = {}) {
    this.read = reader === undefined ? loadXInput() : reader;
    this.intervalMs = intervalMs;
    this.lastIndex = null;
    this.lastAt = 0;
    this.timer = null;
  }

  static busy(pad) {
    if (!pad) return false;
    const dz = 9000;
    return pad.wButtons !== 0 || pad.bLeftTrigger > 60 || pad.bRightTrigger > 60 ||
      Math.abs(pad.sThumbLX) > dz || Math.abs(pad.sThumbLY) > dz || Math.abs(pad.sThumbRX) > dz || Math.abs(pad.sThumbRY) > dz;
  }

  tick(now = Date.now()) {
    if (typeof this.read !== 'function') return;
    for (let i = 0; i < 4; i++) {
      let pad = null;
      try { pad = this.read(i); } catch { pad = null; }
      if (PadTracker.busy(pad)) {
        this.lastIndex = i;
        this.lastAt = now;
      }
    }
  }

  connected() {
    if (typeof this.read !== 'function') return [];
    const out = [];
    for (let i = 0; i < 4; i++) {
      try { if (this.read(i)) out.push(i); } catch { /* nada */ }
    }
    return out;
  }

  // VID/PID del control activo, o null si no se puede saber (en ese caso RetroArch usa su orden normal).
  activeDevice() {
    if (this.lastIndex == null || typeof this.read !== 'function' || typeof this.read.identity !== 'function') return null;
    const index = this.activeIndex();
    if (index !== this.lastIndex) return null;
    try {
      const id = this.read.identity(index);
      return id ? { index, ...id } : null;
    } catch {
      return null;
    }
  }

  // Identidad del control en un indice XInput (para Eden, que pide el GUID de SDL).
  deviceAt(index) {
    if (!Number.isInteger(index) || typeof this.read !== 'function' || typeof this.read.identity !== 'function') return null;
    try {
      const id = this.read.identity(index);
      return id ? { index, ...id } : null;
    } catch {
      return null;
    }
  }

  // Indice XInput del control activo (0 si no se ha usado ninguno o si ya se desconecto).
  activeIndex() {
    if (this.lastIndex == null) return 0;
    try { return this.read(this.lastIndex) ? this.lastIndex : 0; } catch { return 0; }
  }

  start() {
    if (typeof this.read !== 'function' || this.timer) return false;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// Orden de jugadores: el control activo primero y luego los demas, sin repetir.
function playerOrder(active, count = 4) {
  const a = Number.isInteger(active) && active >= 0 && active < count ? active : 0;
  return [a, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== a)];
}

module.exports = { ComboWatcher, PadTracker, playerOrder, BTN, loadXInput };
