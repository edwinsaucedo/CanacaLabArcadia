'use strict';
// Configuraciones iniciales que CanacaLabArcadia deja listas para que "conectar y jugar" funcione:
//  - RetroArch: archivo extra (--appendconfig) con pantalla completa, XInput y carpetas de BIOS/guardados.
//  - Dolphin: perfiles de control para GameCube y Wiimote + Nunchuk usando el control XInput de la Ally X.
// Nunca se sobreescribe un archivo que ya exista: si cambiaste algo a mano, se respeta.
const fs = require('fs');
const path = require('path');
const { playerOrder } = require('./xinput');

function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

// player1Device: { vid, pid } del control con el que abriste el juego; RetroArch lo pone como jugador 1
// (reserva "preferida"), sin importar en que orden detecte los controles.
// joypadDriver: sdl3 reconoce el control de la Ally X y los de Xbox por Bluetooth con el mapeo estandar.
function retroarchAppendConfig(dataRoot, { player1Device = null, joypadDriver = 'sdl3' } = {}) {
  const bios = path.join(dataRoot, 'bios');
  const saves = path.join(dataRoot, 'saves', 'retroarch');
  const states = path.join(saves, 'states');
  for (const d of [bios, saves, states]) fs.mkdirSync(d, { recursive: true });
  // Este archivo SI se regenera siempre: solo contiene lo que CanacaLabArcadia necesita.
  const lines = [
    '# Generado por CanacaLabArcadia. Se carga encima de tu retroarch.cfg normal.',
    'video_fullscreen = "true"',
    `input_joypad_driver = "${joypadDriver}"`,
    'input_autodetect_enable = "true"',
    '# Menu de RetroArch con L3 + R3 (clic en ambos sticks)',
    'input_menu_toggle_gamepad_combo = "2"',
    'pause_nonactive = "false"',
    'notification_show_autoconfig = "true"',
    `system_directory = "${bios}"`,
    `savefile_directory = "${saves}"`,
    `savestate_directory = "${states}"`,
    'sort_savefiles_by_content_enable = "true"',
    'sort_savestates_by_content_enable = "true"',
    '# El control con el que abriste el juego es el jugador 1 (la Ally X tiene su control integrado como control 1).',
    ...playerOrder(0).map((idx, n) => `input_player${n + 1}_joypad_index = "${idx}"`),
    `input_player1_device_reservation_type = "${player1Device ? 1 : 0}"`,
    `input_player1_reserved_device = "${player1Device ? reservedId(player1Device) : ''}"`,
    '# Registro para revisar que controles detecta RetroArch (carpeta logs de la biblioteca).',
    `log_dir = "${path.join(dataRoot, 'logs')}"`,
    'log_to_file = "true"',
    'log_to_file_timestamp = "false"',
    'log_verbosity = "true"',
    'frontend_log_level = "1"'
  ];
  const file = path.join(dataRoot, 'config', 'retroarch-arcadia.cfg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
  return file;
}

const DEVICE = 'XInput/0/Gamepad';

// "045e:0b13": el formato VID:PID (hexadecimal) que entiende la reserva de controles de RetroArch.
function reservedId({ vid, pid }) {
  const hex = (n) => Number(n).toString(16).padStart(4, '0');
  return `${hex(vid)}:${hex(pid)}`;
}

function dolphinGcPad() {
  return [
    '[GCPad1]',
    `Device = ${DEVICE}`,
    'Buttons/A = `Button A`',
    'Buttons/B = `Button B`',
    'Buttons/X = `Button X`',
    'Buttons/Y = `Button Y`',
    'Buttons/Z = `Shoulder R`',
    'Buttons/Start = Start',
    'Main Stick/Up = `Left Y+`',
    'Main Stick/Down = `Left Y-`',
    'Main Stick/Left = `Left X-`',
    'Main Stick/Right = `Left X+`',
    'Main Stick/Modifier = `Shoulder L`',
    'C-Stick/Up = `Right Y+`',
    'C-Stick/Down = `Right Y-`',
    'C-Stick/Left = `Right X-`',
    'C-Stick/Right = `Right X+`',
    'Triggers/L = `Trigger L`',
    'Triggers/R = `Trigger R`',
    'Triggers/L-Analog = `Trigger L`',
    'Triggers/R-Analog = `Trigger R`',
    'D-Pad/Up = `Pad N`',
    'D-Pad/Down = `Pad S`',
    'D-Pad/Left = `Pad W`',
    'D-Pad/Right = `Pad E`',
    'Rumble/Motor = `Motor L` | `Motor R`',
    ''
  ].join('\r\n');
}

// Wiimote + Nunchuk en un control normal: el stick derecho mueve el puntero (IR).
function dolphinWiimote() {
  return [
    '[Wiimote1]',
    'Source = 1',
    `Device = ${DEVICE}`,
    'Buttons/A = `Button A`',
    'Buttons/B = `Trigger R`',
    'Buttons/1 = `Button X`',
    'Buttons/2 = `Button Y`',
    'Buttons/- = Back',
    'Buttons/+ = Start',
    'Buttons/Home = `Thumb R`',
    'IR/Up = `Right Y+`',
    'IR/Down = `Right Y-`',
    'IR/Left = `Right X-`',
    'IR/Right = `Right X+`',
    'Shake/X = `Thumb L`',
    'Shake/Y = `Thumb L`',
    'Shake/Z = `Thumb L`',
    'D-Pad/Up = `Pad N`',
    'D-Pad/Down = `Pad S`',
    'D-Pad/Left = `Pad W`',
    'D-Pad/Right = `Pad E`',
    'Extension = Nunchuk',
    'Nunchuk/Buttons/C = `Shoulder L`',
    'Nunchuk/Buttons/Z = `Trigger L`',
    'Nunchuk/Stick/Up = `Left Y+`',
    'Nunchuk/Stick/Down = `Left Y-`',
    'Nunchuk/Stick/Left = `Left X-`',
    'Nunchuk/Stick/Right = `Left X+`',
    'Nunchuk/Shake/X = `Shoulder R`',
    'Nunchuk/Shake/Y = `Shoulder R`',
    'Nunchuk/Shake/Z = `Shoulder R`',
    'Rumble/Motor = `Motor L` | `Motor R`',
    '[Wiimote2]',
    'Source = 0',
    '[Wiimote3]',
    'Source = 0',
    '[Wiimote4]',
    'Source = 0',
    '[BalanceBoard]',
    'Source = 0',
    ''
  ].join('\r\n');
}

function dolphinIni() {
  return [
    '[Interface]',
    'ConfirmStop = False',
    'UsePanicHandlers = False',
    '[Display]',
    'Fullscreen = True',
    '[Core]',
    'SIDevice0 = 6',
    ''
  ].join('\r\n');
}

// Se llama despues de instalar Dolphin o antes de lanzar un juego de GameCube/Wii.
function ensureDolphinProfiles(dolphinExe) {
  const dir = path.dirname(dolphinExe);
  const portable = path.join(dir, 'portable.txt');
  if (!fs.existsSync(portable)) fs.writeFileSync(portable, '');
  const cfg = path.join(dir, 'User', 'Config');
  return {
    gcpad: writeIfMissing(path.join(cfg, 'GCPadNew.ini'), dolphinGcPad()),
    wiimote: writeIfMissing(path.join(cfg, 'WiimoteNew.ini'), dolphinWiimote()),
    ini: writeIfMissing(path.join(cfg, 'Dolphin.ini'), dolphinIni())
  };
}

// Pone en el jugador 1 de Dolphin (GameCube y Wiimote) el control que usaste para abrir el juego.
// Solo cambia el primer "Device = XInput/N/Gamepad" de cada archivo: si elegiste otro dispositivo, se respeta.
function setDolphinPlayer1(dolphinExe, index = 0) {
  const cfg = path.join(path.dirname(dolphinExe), 'User', 'Config');
  const changed = [];
  for (const name of ['GCPadNew.ini', 'WiimoteNew.ini']) {
    const file = path.join(cfg, name);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const next = text.replace(/^(Device\s*=\s*XInput\/)\d+(\/Gamepad)\s*$/m, `$1${index}$2`);
    if (next !== text) {
      fs.writeFileSync(file, next, 'utf8');
      changed.push(name);
    }
  }
  return changed;
}

// ---------------------------------------------------------------- controles automaticos

const MARK = 'CanacaLabArcadia';

// Escribe un archivo de configuracion de controles solo si no existe o si lo genero CanacaLabArcadia
// (si lo editaste a mano y quitaste la marca, se respeta).
function writeOwned(file, content) {
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* no existe */ }
  if (current !== null && !current.includes(MARK)) return false;
  if (current === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

// RetroArch con el driver SDL3 nombra a los controles XInput (Xbox, ROG Ally) "XInput Controller", y ese nombre
// coincide con un perfil interno pensado para el driver xinput: con el, la cruceta, LB/RB, Select y L3/R3 quedan
// mal. Este perfil (que RetroArch lee antes que los internos) usa la numeracion de SDL3.
function retroarchSdl3Profile() {
  const lines = [
    `# Generado por ${MARK}: controles XInput (Xbox, ROG Ally) con el driver sdl3.`,
    'input_driver = "sdl3"',
    'input_device = "XInput Controller"',
    'input_device_display_name = "Control Xbox / ROG Ally"',
    'input_b_btn = "0"', 'input_a_btn = "1"', 'input_y_btn = "2"', 'input_x_btn = "3"',
    'input_select_btn = "4"', 'input_menu_toggle_btn = "5"', 'input_start_btn = "6"',
    'input_l3_btn = "7"', 'input_r3_btn = "8"', 'input_l_btn = "9"', 'input_r_btn = "10"',
    'input_up_btn = "11"', 'input_down_btn = "12"', 'input_left_btn = "13"', 'input_right_btn = "14"',
    'input_l2_axis = "+4"', 'input_r2_axis = "+5"',
    'input_l_x_plus_axis = "+0"', 'input_l_x_minus_axis = "-0"', 'input_l_y_plus_axis = "+1"', 'input_l_y_minus_axis = "-1"',
    'input_r_x_plus_axis = "+2"', 'input_r_x_minus_axis = "-2"', 'input_r_y_plus_axis = "+3"', 'input_r_y_minus_axis = "-3"',
    'input_b_btn_label = "A"', 'input_a_btn_label = "B"', 'input_y_btn_label = "X"', 'input_x_btn_label = "Y"',
    'input_select_btn_label = "View"', 'input_start_btn_label = "Menu"'
  ];
  return lines.join('\r\n') + '\r\n';
}

function ensureRetroArchProfiles(retroarchExe) {
  const dir = path.join(path.dirname(retroarchExe), 'autoconfig', 'sdl3');
  return writeOwned(path.join(dir, 'XInput Controller.cfg'), retroarchSdl3Profile());
}

// RPCS3 empieza con el teclado como jugador 1. Este perfil global pone el control XInput (indice 0-3)
// con el mapeo de RPCS3 para XInput.
function rpcs3InputConfig(index = 0) {
  const map = {
    'Left Stick Left': 'LS X-', 'Left Stick Down': 'LS Y-', 'Left Stick Right': 'LS X+', 'Left Stick Up': 'LS Y+',
    'Right Stick Left': 'RS X-', 'Right Stick Down': 'RS Y-', 'Right Stick Right': 'RS X+', 'Right Stick Up': 'RS Y+',
    Start: 'Start', Select: 'Back', 'PS Button': 'Guide',
    Square: 'X', Cross: 'A', Circle: 'B', Triangle: 'Y',
    Left: 'Left', Down: 'Down', Right: 'Right', Up: 'Up',
    R1: 'RB', R2: 'RT', R3: 'RS', L1: 'LB', L2: 'LT', L3: 'LS'
  };
  const nums = {
    'Left Stick Deadzone': 7849, 'Right Stick Deadzone': 8689, 'Left Stick Anti-Deadzone': 4259, 'Right Stick Anti-Deadzone': 4259,
    'Left Trigger Threshold': 30, 'Right Trigger Threshold': 30, 'Left Stick Multiplier': 100, 'Right Stick Multiplier': 100
  };
  const out = [
    `# Generado por ${MARK}: el jugador 1 es el control con el que abriste el juego.`,
    'Player 1 Input:',
    '  Handler: XInput',
    // Entre comillas: en YAML, " #" empieza un comentario y RPCS3 leeria solo "XInput Pad" (sin control).
    `  Device: "XInput Pad #${(Number.isInteger(index) ? index : 0) + 1}"`,
    '  Config:',
    ...Object.entries(map).map(([k, v]) => `    ${k}: ${v}`),
    ...Object.entries(nums).map(([k, v]) => `    ${k}: ${v}`)
  ];
  return out.join('\n') + '\n';
}

function ensureRpcs3Input(rpcs3Exe, index = 0) {
  const file = path.join(path.dirname(rpcs3Exe), 'config', 'input_configs', 'global', 'Default.yml');
  return writeOwned(file, rpcs3InputConfig(index));
}

function ensureLibraryFolders(dataRoot, catalog) {
  const made = [];
  const dirs = [
    path.join(dataRoot, 'bios'),
    path.join(dataRoot, 'saves'),
    path.join(dataRoot, 'emulators'),
    path.join(dataRoot, 'config'),
    path.join(dataRoot, 'media', 'covers')
  ];
  for (const s of catalog.systems) {
    dirs.push(path.join(dataRoot, 'roms', s.id));
    dirs.push(path.join(dataRoot, 'media', 'covers', s.id));
  }
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      made.push(d);
    }
  }
  // Instrucciones dentro de cada carpeta para no tener que recordar formatos.
  for (const s of catalog.systems) {
    const exts = s.folderGames
      ? 'Carpetas de juego' + (s.ext.length ? ` o archivos ${s.ext.join(', ')}` : '')
      : s.ext.join(', ');
    const note = [
      `${s.name}`,
      '',
      `Pon aquí tus juegos de ${s.short}.`,
      `Formatos: ${exts}`,
      s.requires ? `Requisito: ${s.requires}` : '',
      '',
      'También puedes arrastrar los archivos a la ventana de CanacaLabArcadia y ella los acomoda sola.'
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\r\n');
    writeIfMissing(path.join(dataRoot, 'roms', s.id, 'LEEME.txt'), note + '\r\n');
  }
  return made;
}

module.exports = { retroarchAppendConfig, reservedId, ensureRetroArchProfiles, retroarchSdl3Profile, ensureRpcs3Input, rpcs3InputConfig, ensureDolphinProfiles, setDolphinPlayer1, ensureLibraryFolders, dolphinGcPad, dolphinWiimote };
