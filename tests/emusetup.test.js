'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const {
  preparePcsx2, prepareXemu, ps2BiosInfo, findPs2Bios, getValue, setValue, setValues
} = require('../src/main/emusetup');
const { retroarchAppendConfig, setDolphinPlayer1, ensureDolphinProfiles, ensureRetroArchProfiles, ensureRpcs3Input } = require('../src/main/configs');
const { PadTracker, playerOrder } = require('../src/main/xinput');

const FABRICA = fs.readFileSync(path.join(__dirname, 'fixtures', 'PCSX2-fabrica.ini'), 'utf8');

const { fakePs2Bios } = h;

function pcsx2Install(ini = FABRICA) {
  const root = h.tmpDir('pcsx2-');
  const emu = path.join(root, 'emulators', 'pcsx2');
  fs.mkdirSync(path.join(emu, 'inis'), { recursive: true });
  fs.writeFileSync(path.join(emu, 'pcsx2-qt.exe'), '');
  fs.writeFileSync(path.join(emu, 'portable.ini'), '');
  if (ini != null) fs.writeFileSync(path.join(emu, 'inis', 'PCSX2.ini'), ini);
  fs.mkdirSync(path.join(root, 'bios'), { recursive: true });
  return { root, exe: path.join(emu, 'pcsx2-qt.exe'), ini: path.join(emu, 'inis', 'PCSX2.ini') };
}

test('INI: cambia o agrega claves sin tocar lo demas y respeta CRLF', () => {
  let t = '[UI]\r\nA = 1\r\n\r\n[Pad1]\r\nUp = Keyboard/Up\r\n';
  t = setValue(t, 'UI', 'A', '2');
  t = setValue(t, 'UI', 'B', 'x');
  t = setValue(t, 'Nueva', 'C', 'y');
  t = setValues(t, 'Pad1', 'Up', ['SDL-0/DPadUp', 'SDL-1/DPadUp']);
  assert.equal(getValue(t, 'UI', 'A'), '2');
  assert.equal(getValue(t, 'UI', 'B'), 'x');
  assert.equal(getValue(t, 'Nueva', 'C'), 'y');
  assert.match(t, /Up = SDL-0\/DPadUp\r\nUp = SDL-1\/DPadUp/);
  assert.ok(!/[^\r]\n/.test(t), 'todo en CRLF');
});

test('BIOS de PS2: se reconoce por su ROMDIR y se prefiere el de EE.UU.', () => {
  const { root } = pcsx2Install();
  fs.writeFileSync(path.join(root, 'bios', 'scph39001.bin'), fakePs2Bios('0160EC20010704'));
  fs.writeFileSync(path.join(root, 'bios', 'SCPH-70012_BIOS_V12_USA_200.BIN'), fakePs2Bios('0200AC20040614'));
  fs.writeFileSync(path.join(root, 'bios', 'scph5501.bin'), Buffer.alloc(512 * 1024)); // BIOS de PS1: no cuenta
  fs.writeFileSync(path.join(root, 'bios', 'basura.bin'), Buffer.alloc(4 * 1024 * 1024)); // 4 MB sin ROMDIR
  assert.deepEqual(ps2BiosInfo(path.join(root, 'bios', 'scph39001.bin')), { version: '01.60', region: 'E', zone: 'Europa' });
  assert.equal(findPs2Bios(root).name, 'SCPH-70012_BIOS_V12_USA_200.BIN');
});

test('PCSX2 sin BIOS: avisa con instrucciones y no cambia nada', () => {
  const { root, exe, ini } = pcsx2Install();
  const r = preparePcsx2({ exe, dataRoot: root });
  assert.equal(r.ok, false);
  assert.match(r.message, /Falta el BIOS de PS2.*carpeta BIOS de tu Google Drive/);
  assert.equal(fs.readFileSync(ini, 'utf8'), FABRICA);
});

test('PCSX2 de fabrica (como el de tu Ally X): BIOS, sin asistente y control en vez de teclado', () => {
  const { root, exe, ini } = pcsx2Install();
  fs.writeFileSync(path.join(root, 'bios', 'ps2-usa.bin'), fakePs2Bios());
  const r = preparePcsx2({ exe, dataRoot: root });
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const t = fs.readFileSync(ini, 'utf8');
  assert.equal(getValue(t, 'UI', 'SettingsVersion'), '1');
  assert.equal(getValue(t, 'UI', 'SetupWizardIncomplete'), 'false');
  assert.equal(getValue(t, 'Folders', 'Bios'), path.join(root, 'bios'));
  assert.equal(getValue(t, 'Filenames', 'BIOS'), 'ps2-usa.bin');
  assert.equal(getValue(t, 'Pad1', 'Type'), 'DualShock2');
  assert.equal(getValue(t, 'Pad1', 'Cross'), 'SDL-0/FaceSouth');
  assert.match(t, /Cross = SDL-0\/FaceSouth\r\nCross = SDL-1\/FaceSouth\r\n/, 'el control integrado y uno externo');
  assert.match(t, /Cross = SDL-1\/FaceSouth\r\nCross = Keyboard\/K\r\n/, 'y el teclado sigue sirviendo');
  assert.equal(getValue(t, 'Hotkeys', 'OpenPauseMenu'), 'Keyboard/Escape', 'lo demas sigue igual');
  assert.equal(t.split(/\r?\n/).length > FABRICA.split(/\r?\n/).length, true);
  // Segunda vez: nada que cambiar.
  assert.equal(preparePcsx2({ exe, dataRoot: root }).changed, false);
});

test('PCSX2 ya configurado a mano: se respetan tu BIOS y tus botones', () => {
  let custom = setValue(FABRICA, 'Folders', 'Bios', 'bios');
  custom = setValue(custom, 'Filenames', 'BIOS', 'mio.bin');
  custom = setValue(custom, 'Pad1', 'Cross', 'SDL-0/FaceEast');
  custom = setValue(custom, 'Pad1', 'Up', 'SDL-0/DPadUp');
  const { root, exe, ini } = pcsx2Install(custom);
  fs.mkdirSync(path.join(path.dirname(exe), 'bios'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(exe), 'bios', 'mio.bin'), fakePs2Bios('0100JC20000117'));
  fs.writeFileSync(path.join(root, 'bios', 'otro.bin'), fakePs2Bios());
  const r = preparePcsx2({ exe, dataRoot: root });
  assert.equal(r.ok, true);
  const t = fs.readFileSync(ini, 'utf8');
  assert.equal(getValue(t, 'Filenames', 'BIOS'), 'mio.bin');
  assert.equal(getValue(t, 'Folders', 'Bios'), 'bios');
  assert.equal(getValue(t, 'Pad1', 'Cross'), 'SDL-0/FaceEast');
});

test('PCSX2 sin archivo de configuracion: se crea uno valido (con SettingsVersion)', () => {
  const { root, exe, ini } = pcsx2Install(null);
  fs.writeFileSync(path.join(root, 'bios', 'ps2.bin'), fakePs2Bios());
  assert.equal(preparePcsx2({ exe, dataRoot: root }).ok, true);
  const t = fs.readFileSync(ini, 'utf8');
  assert.equal(getValue(t, 'UI', 'SettingsVersion'), '1');
  assert.equal(getValue(t, 'Pad1', 'Start'), 'SDL-0/Start');
});

function xemuInstall({ portable = false } = {}) {
  const root = h.tmpDir('xemu-');
  const emu = path.join(root, 'emulators', 'xemu');
  fs.mkdirSync(emu, { recursive: true });
  fs.writeFileSync(path.join(emu, 'xemu.exe'), '');
  if (portable) fs.writeFileSync(path.join(emu, 'xemu.toml'), '');
  fs.mkdirSync(path.join(root, 'bios'), { recursive: true });
  const appData = path.join(root, 'AppData', 'Roaming');
  return { root, exe: path.join(emu, 'xemu.exe'), appData };
}

test('xemu: dice exactamente que archivo falta', () => {
  const { root, exe, appData } = xemuInstall();
  fs.writeFileSync(path.join(root, 'bios', 'mcpx_1.0.bin'), Buffer.alloc(512));
  const r = prepareXemu({ exe, dataRoot: root, appDataDir: appData });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['flashrom', 'hdd']);
  assert.match(r.message, /BIOS de Xbox.*disco duro \(xbox_hdd\.qcow2\)/);
});

test('xemu: con los 3 archivos queda listo (pantalla completa y sin bienvenida)', () => {
  const { root, exe, appData } = xemuInstall();
  fs.writeFileSync(path.join(root, 'bios', 'mcpx_1.0.bin'), Buffer.alloc(512));
  fs.writeFileSync(path.join(root, 'bios', 'Complex_4627.bin'), Buffer.alloc(1024 * 1024));
  fs.writeFileSync(path.join(root, 'bios', 'firmware.bin'), Buffer.alloc(256 * 1024)); // firmware de DS: no es de Xbox
  fs.writeFileSync(path.join(root, 'bios', 'xbox_hdd.qcow2'), 'QFI');
  const r = prepareXemu({ exe, dataRoot: root, appDataDir: appData });
  assert.equal(r.ok, true);
  assert.equal(r.file, path.join(appData, 'xemu', 'xemu', 'xemu.toml'));
  const t = fs.readFileSync(r.file, 'utf8');
  assert.equal(getValue(t, 'sys.files', 'flashrom_path'), `'${path.join(root, 'bios', 'Complex_4627.bin')}'`);
  assert.equal(getValue(t, 'sys.files', 'bootrom_path'), `'${path.join(root, 'bios', 'mcpx_1.0.bin')}'`);
  assert.equal(getValue(t, 'sys.files', 'hdd_path'), `'${path.join(root, 'bios', 'xbox_hdd.qcow2')}'`);
  assert.equal(getValue(t, 'general', 'show_welcome'), 'false');
  assert.equal(getValue(t, 'display.window', 'fullscreen_on_startup'), 'true');
});

test('xemu portable (xemu.toml junto al .exe) se configura ahi', () => {
  const { root, exe, appData } = xemuInstall({ portable: true });
  fs.mkdirSync(path.join(root, 'bios', 'xbox'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bios', 'xbox', 'mcpx.bin'), Buffer.alloc(512));
  fs.writeFileSync(path.join(root, 'bios', 'xbox', 'bios.bin'), Buffer.alloc(1024 * 1024));
  fs.writeFileSync(path.join(root, 'bios', 'xbox', 'disco.qcow2'), 'QFI');
  const r = prepareXemu({ exe, dataRoot: root, appDataDir: appData });
  assert.equal(r.ok, true);
  assert.equal(r.file, path.join(path.dirname(exe), 'xemu.toml'));
});

test('RetroArch: SDL3 y el control con el que abres el juego reservado como jugador 1', () => {
  assert.deepEqual(playerOrder(1), [1, 0, 2, 3]);
  assert.deepEqual(playerOrder(undefined), [0, 1, 2, 3]);
  const root = h.tmpDir('ra-');
  // Control de Xbox por Bluetooth (045e:0b13).
  const cfg = fs.readFileSync(retroarchAppendConfig(root, { player1Device: { vid: 0x045e, pid: 0x0b13 } }), 'utf8');
  assert.match(cfg, /input_joypad_driver = "sdl3"/);
  assert.match(cfg, /input_player1_device_reservation_type = "1"/);
  assert.match(cfg, /input_player1_reserved_device = "045e:0b13"/);
  assert.match(cfg, /log_to_file = "true"/);
  // Sin saber que control se uso: sin reserva (y se limpia una reserva vieja).
  const def = fs.readFileSync(retroarchAppendConfig(root), 'utf8');
  assert.match(def, /input_player1_device_reservation_type = "0"/);
  assert.match(def, /input_player1_reserved_device = ""/);
  assert.match(def, /input_player1_joypad_index = "0"/);
  assert.match(fs.readFileSync(retroarchAppendConfig(root, { joypadDriver: 'xinput' }), 'utf8'), /input_joypad_driver = "xinput"/);
});

test('Dolphin: el jugador 1 usa el control activo y se respeta otro dispositivo elegido a mano', () => {
  const dir = h.tmpDir('dolphin-');
  const exe = path.join(dir, 'Dolphin.exe');
  fs.writeFileSync(exe, '');
  ensureDolphinProfiles(exe);
  assert.deepEqual(setDolphinPlayer1(exe, 1), ['GCPadNew.ini', 'WiimoteNew.ini']);
  const gc = fs.readFileSync(path.join(dir, 'User', 'Config', 'GCPadNew.ini'), 'utf8');
  assert.match(gc, /Device = XInput\/1\/Gamepad/);
  fs.writeFileSync(path.join(dir, 'User', 'Config', 'GCPadNew.ini'), '[GCPad1]\nDevice = SDL/0/Mi control\n');
  assert.deepEqual(setDolphinPlayer1(exe, 0), ['WiimoteNew.ini']);
});

test('PadTracker recuerda el ultimo control usado', () => {
  const pads = [{ wButtons: 0, bLeftTrigger: 0, bRightTrigger: 0, sThumbLX: 0, sThumbLY: 0, sThumbRX: 0, sThumbRY: 0 }, null, null, null];
  pads[1] = { ...pads[0] };
  const t = new PadTracker({ reader: (i) => pads[i] });
  t.tick();
  assert.equal(t.activeIndex(), 0, 'sin usar ninguno: el 0');
  pads[1] = { ...pads[1], wButtons: 0x1000 };
  t.tick();
  assert.equal(t.activeIndex(), 1, 'presionaste A en el control de Xbox');
  pads[1] = null;
  assert.equal(t.activeIndex(), 0, 'si se desconecta, vuelve al integrado');
  assert.deepEqual(t.connected(), [0]);
});

test('PadTracker da el VID/PID del control activo para la reserva de RetroArch', () => {
  const idle = { wButtons: 0, bLeftTrigger: 0, bRightTrigger: 0, sThumbLX: 0, sThumbLY: 0, sThumbRX: 0, sThumbRY: 0 };
  const pads = [{ ...idle }, { ...idle, wButtons: 0x1000 }];
  const reader = (i) => pads[i] || null;
  reader.identity = (i) => [{ vid: 0x0b05, pid: 0x1b4c }, { vid: 0x045e, pid: 0x0b13 }][i];
  const t = new PadTracker({ reader });
  assert.equal(t.activeDevice(), null, 'sin usar ninguno todavia');
  t.tick();
  assert.deepEqual(t.activeDevice(), { index: 1, vid: 0x045e, pid: 0x0b13 });
});

test('RetroArch: perfil SDL3 para "XInput Controller" (cruceta, LB/RB, Select y sticks bien)', () => {
  const dir = h.tmpDir('ra-prof-');
  const exe = path.join(dir, 'retroarch.exe');
  fs.writeFileSync(exe, '');
  assert.equal(ensureRetroArchProfiles(exe), true);
  const file = path.join(dir, 'autoconfig', 'sdl3', 'XInput Controller.cfg');
  const t = fs.readFileSync(file, 'utf8');
  const val = (k) => (t.match(new RegExp(`^${k} = "([^"]*)"`, 'm')) || [])[1];
  // Numeracion de botones de SDL3 (SDL_GamepadButton), la misma del perfil interno "Gamepad" de RetroArch.
  assert.equal(val('input_device'), 'XInput Controller');
  assert.equal(val('input_b_btn'), '0');
  assert.equal(val('input_select_btn'), '4');
  assert.equal(val('input_start_btn'), '6');
  assert.equal(val('input_l_btn'), '9');
  assert.equal(val('input_r_btn'), '10');
  assert.equal(val('input_up_btn'), '11');
  assert.equal(val('input_right_btn'), '14');
  assert.equal(ensureRetroArchProfiles(exe), false, 'ya estaba');
  // Si lo editas a mano (sin la marca), no se pisa.
  fs.writeFileSync(file, 'input_device = "XInput Controller"\ninput_b_btn = "1"\n');
  assert.equal(ensureRetroArchProfiles(exe), false);
  assert.match(fs.readFileSync(file, 'utf8'), /input_b_btn = "1"/);
});

test('RPCS3: el jugador 1 deja de ser el teclado y usa el control con el que abriste el juego', () => {
  const dir = h.tmpDir('rpcs3-');
  const exe = path.join(dir, 'rpcs3.exe');
  fs.writeFileSync(exe, '');
  assert.equal(ensureRpcs3Input(exe, 1), true);
  const file = path.join(dir, 'config', 'input_configs', 'global', 'Default.yml');
  const t = fs.readFileSync(file, 'utf8');
  assert.match(t, /^Player 1 Input:\n  Handler: XInput\n  Device: "XInput Pad #2"\n  Config:\n/m);
  // En YAML, " #2" sin comillas seria un comentario: RPCS3 leeria "XInput Pad" y se quedaria sin control.
  assert.doesNotMatch(t, /Device: XInput Pad #/);
  assert.match(t, /^    Cross: A$/m);
  assert.match(t, /^    Select: Back$/m);
  assert.match(t, /^    L2: LT$/m);
  assert.equal(ensureRpcs3Input(exe, 0), true, 'cambia al otro control');
  assert.match(fs.readFileSync(file, 'utf8'), /Device: "XInput Pad #1"/);
});

test('PS3: avisa si falta el firmware y lo encuentra en bios o en Descargas', () => {
  const { prepareRpcs3, prepareEmulator } = require('../src/main/emusetup');
  const root = h.tmpDir('ps3-');
  const emu = path.join(root, 'emulators', 'rpcs3');
  fs.mkdirSync(emu, { recursive: true });
  const exe = path.join(emu, 'rpcs3.exe');
  fs.writeFileSync(exe, '');
  const downloads = path.join(root, 'Descargas');
  fs.mkdirSync(downloads);

  let r = prepareEmulator('rpcs3', { exe, dataRoot: root, downloadsDir: downloads });
  assert.equal(r.ok, false);
  assert.equal(r.short, 'Falta el firmware de PS3');
  assert.equal(r.pup, null);
  assert.match(r.message, /Página de Sony/);

  // Lo bajaste de la pagina de Sony: queda en Descargas.
  const pup = path.join(downloads, 'PS3UPDAT.PUP');
  fs.writeFileSync(pup, Buffer.alloc(11 * 1024 * 1024));
  r = prepareRpcs3({ exe, dataRoot: root, downloadsDir: downloads });
  assert.equal(r.pup, pup);
  assert.match(r.message, /Instalar firmware/);

  // RPCS3 ya lo instalo (dev_flash/vsh/module/vsh.self).
  fs.mkdirSync(path.join(emu, 'dev_flash', 'vsh', 'module'), { recursive: true });
  fs.writeFileSync(path.join(emu, 'dev_flash', 'vsh', 'module', 'vsh.self'), '');
  assert.equal(prepareRpcs3({ exe, dataRoot: root, downloadsDir: downloads }).ok, true);
});

test('xemu: con tu carpeta BIOS real elige Complex_4627v1.03 y nunca un BIOS debug', () => {
  const { findXboxFiles } = require('../src/main/emusetup');
  const root = h.tmpDir('xbox-bios-');
  const bios = path.join(root, 'bios');
  fs.mkdirSync(bios, { recursive: true });
  const MBb = 1024 * 1024;
  // Los mismos nombres y tamaños que tienes en tu carpeta BIOS de Drive.
  const files = {
    'mcpx_1.0.bin': 512, 'Complex_4627Debugv1.03.bin': MBb, 'Complex_4627v1.03.bin': MBb, 'xbox-4627_debug.bin': MBb,
    'xbox-3944.bin': MBb, 'xbox-3944_256k.bin': 256 * 1024, 'xbox-4034.bin': MBb, 'xbox-4817.bin': MBb,
    'xbox-5101.bin': 256 * 1024, 'xbox-5530.bin': 256 * 1024, 'xbox-5713.bin': 256 * 1024, 'xbox-5838.bin': 256 * 1024,
    'scph5501.bin': 512 * 1024, 'SCPH1001.BIN': 512 * 1024, 'scph39001.bin': 4 * MBb, 'neogeo.zip': 1000
  };
  for (const [n, size] of Object.entries(files)) fs.writeFileSync(path.join(bios, n), Buffer.alloc(size));
  const r = findXboxFiles(root);
  assert.equal(r.bootrom.name, 'mcpx_1.0.bin');
  assert.equal(r.flashrom.name, 'Complex_4627v1.03.bin');
  assert.equal(r.hdd, null, 'el disco duro todavia falta');
  fs.unlinkSync(path.join(bios, 'Complex_4627v1.03.bin'));
  assert.ok(!/debug/i.test(findXboxFiles(root).flashrom.name), 'sin Complex sigue sin elegir uno debug');
});
