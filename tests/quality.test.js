'use strict';
// Calidad de imagen: el valor correcto en el archivo correcto de cada emulador, sin romper lo demas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const q = require('../src/main/quality');

function fakeExe(name, extra = []) {
  const dir = h.tmpDir('emu-');
  const exe = path.join(dir, name);
  fs.writeFileSync(exe, '');
  for (const f of extra) fs.writeFileSync(path.join(dir, f), '');
  return exe;
}
const read = (f) => fs.readFileSync(f, 'utf8');

test('calidad: niveles por consola, Alta por defecto y Original en PS3 y Switch', () => {
  assert.equal(q.levelFor({}, 'ps2'), 'alta');
  assert.equal(q.levelFor({}, 'ps3'), 'original');
  assert.equal(q.levelFor({}, 'switch'), 'original');
  assert.equal(q.levelFor({ calidad: { ps2: 'maxima' } }, 'ps2'), 'maxima');
  assert.equal(q.levelFor({ calidad: { ps2: 'loquesea' } }, 'ps2'), 'alta', 'un valor raro usa el recomendado');
  assert.equal(q.levelFor({}, 'snes'), null, 'las consolas 2D no tienen este ajuste');
  const table = q.qualityTable({ calidad: { gamecube: 'original' } });
  assert.deepEqual(table.map((r) => r.id), ['ps2', 'gamecube', 'wii', 'psp', 'n64', 'xbox', 'ps3', 'switch']);
  assert.equal(table.find((r) => r.id === 'gamecube').level, 'original');
  assert.deepEqual(table[0].options.map((o) => `${o.name} ${o.text}`), ['Original 1x · 480p', 'Alta 3x · 1080p', 'Máxima 4x · 1440p']);
});

test('PS2 (PCSX2): upscale_multiplier en PCSX2.ini, sin perder el BIOS ni abrir el asistente', () => {
  const exe = fakeExe('pcsx2-qt.exe', ['portable.ini']);
  const r = q.applyQuality({ systemId: 'ps2', emu: 'pcsx2', exe, settings: {} });
  assert.equal(r.file, path.join(path.dirname(exe), 'inis', 'PCSX2.ini'));
  let ini = read(r.file);
  assert.match(ini, /SettingsVersion = 1/, 'archivo nuevo: con SettingsVersion PCSX2 no lo borra');
  assert.match(ini, /\[EmuCore\/GS\]\r?\nupscale_multiplier = 3/);
  fs.writeFileSync(r.file, '[UI]\r\nSettingsVersion = 1\r\n\r\n[Filenames]\r\nBIOS = SCPH-70012.bin\r\n\r\n[EmuCore/GS]\r\nupscale_multiplier = 2\r\nRenderer = 14\r\n');
  q.applyQuality({ systemId: 'ps2', emu: 'pcsx2', exe, settings: { calidad: { ps2: 'maxima' } } });
  ini = read(r.file);
  assert.match(ini, /upscale_multiplier = 4\r\nRenderer = 14/);
  assert.match(ini, /BIOS = SCPH-70012\.bin/);
  const again = q.applyQuality({ systemId: 'ps2', emu: 'pcsx2', exe, settings: { calidad: { ps2: 'maxima' } } });
  assert.equal(again.changed, false, 'si ya esta, no se reescribe');
});

test('GameCube/Wii (Dolphin): InternalResolution en User\\Config\\GFX.ini, cada consola con su nivel', () => {
  const exe = fakeExe('Dolphin.exe', ['portable.txt']);
  const file = path.join(path.dirname(exe), 'User', 'Config', 'GFX.ini');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[Settings]\r\nAspectRatio = 0\r\n[Enhancements]\r\nMaxAnisotropy = 2\r\n');
  q.applyQuality({ systemId: 'gamecube', emu: 'dolphin', exe, settings: {} });
  assert.match(read(file), /\[Settings\]\r\nAspectRatio = 0\r\nInternalResolution = 3\r\n\[Enhancements\]/);
  q.applyQuality({ systemId: 'wii', emu: 'dolphin', exe, settings: { calidad: { wii: 'original' } } });
  assert.match(read(file), /InternalResolution = 1/);
  assert.equal(q.applyQuality({ systemId: 'gamecube', emu: 'pcsx2', exe, settings: {} }), null, 'solo con el emulador de esa consola');
});

test('PSP (PPSSPP): InternalResolution en memstick\\PSP\\SYSTEM\\ppsspp.ini (o en Documentos si esta instalado)', () => {
  const exe = fakeExe('PPSSPPWindows64.exe');
  const r = q.applyQuality({ systemId: 'psp', emu: 'ppsspp', exe, settings: {} });
  assert.equal(r.file, path.join(path.dirname(exe), 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini'));
  assert.match(read(r.file), /\[Graphics\]\r?\nInternalResolution = 4/);
  const docs = h.tmpDir('docs-');
  const installed = fakeExe('PPSSPPWindows64.exe', ['installed.txt']);
  assert.equal(q.ppssppIniPath(installed, docs), path.join(docs, 'PPSSPP', 'PSP', 'SYSTEM', 'ppsspp.ini'));
});

test('N64 (RetroArch Mupen64Plus-Next): opciones del nucleo, con GLideN64 y ParaLLEl-RDP', () => {
  const exe = fakeExe('retroarch.exe');
  const file = path.join(path.dirname(exe), 'config', 'Mupen64Plus-Next', 'Mupen64Plus-Next.opt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'mupen64plus-aspect = "16:9 adjusted"\nmupen64plus-EnableNativeResFactor = "0"\n');
  q.applyQuality({ systemId: 'n64', emu: 'retroarch', exe, core: 'mupen64plus_next', settings: {} });
  const opt = read(file);
  assert.match(opt, /mupen64plus-aspect = "16:9 adjusted"/);
  assert.match(opt, /mupen64plus-EnableNativeResFactor = "4"/);
  assert.match(opt, /mupen64plus-parallel-rdp-upscaling = "4x"/);
  const other = q.applyQuality({ systemId: 'n64', emu: 'retroarch', exe, core: 'parallel_n64', settings: {} });
  assert.equal(other.changed, false);
  assert.match(other.skipped, /parallel_n64/);
});

test('Xbox (xemu): surface_scale en [display.quality] de xemu.toml sin tocar los archivos de BIOS', () => {
  const exe = fakeExe('xemu.exe');
  const toml = path.join(path.dirname(exe), 'xemu.toml');
  fs.writeFileSync(toml, "[sys.files]\nbootrom_path = 'C:\\bios\\mcpx_1.0.bin'\n\n[display.window]\nfullscreen_on_startup = true\n");
  q.applyQuality({ systemId: 'xbox', emu: 'xemu', exe, settings: {} });
  const text = read(toml);
  assert.match(text, /bootrom_path = 'C:\\bios\\mcpx_1\.0\.bin'/);
  assert.match(text, /\[display\.quality\]\nsurface_scale = 2/);
});

test('PS3 (RPCS3): "Resolution Scale" dentro de Video: en config\\config.yml', () => {
  const exe = fakeExe('rpcs3.exe');
  const file = path.join(path.dirname(exe), 'config', 'config.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ['Core:', '  PPU Decoder: Recompiler (LLVM)', 'Video:', '  Renderer: Vulkan', '  Resolution: 1280x720', '  Resolution Scale: 100', '  Vulkan:', '    Adapter: AMD Radeon', 'Audio:', '  Renderer: Cubeb', ''].join('\n'));
  q.applyQuality({ systemId: 'ps3', emu: 'rpcs3', exe, settings: { calidad: { ps3: 'alta' } } });
  const yml = read(file);
  assert.match(yml, /Video:\n {2}Renderer: Vulkan\n {2}Resolution: 1280x720\n {2}Resolution Scale: 150\n {2}Vulkan:\n {4}Adapter: AMD Radeon\nAudio:/);
  // Sin la clave: se agrega dentro de Video. Sin archivo: se crea.
  assert.equal(q.setYaml('Video:\n  Renderer: Vulkan\n', 'Video', 'Resolution Scale', '200'), 'Video:\n  Resolution Scale: 200\n  Renderer: Vulkan\n');
  const fresh = fakeExe('rpcs3.exe');
  const r = q.applyQuality({ systemId: 'ps3', emu: 'rpcs3', exe: fresh, settings: {} });
  assert.equal(r.file, path.join(path.dirname(fresh), 'config', 'config.yml'));
  assert.equal(read(r.file), 'Video:\n  Resolution Scale: 100\n');
});

test('Switch (Eden): resolution_setup en [Renderer] con el numero de la lista de Eden', () => {
  const exe = fakeExe('eden.exe');
  const dir = path.join(path.dirname(exe), 'user', 'config');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'qt-config.ini');
  fs.writeFileSync(file, '[Renderer]\r\nbackend\\default=true\r\nbackend=1\r\nresolution_setup\\default=true\r\nresolution_setup=3\r\n\r\n[UI]\r\ntheme=default\r\n');
  q.applyQuality({ systemId: 'switch', emu: 'eden', exe, settings: { calidad: { switch: 'alta' } } });
  let ini = read(file);
  assert.match(ini, /resolution_setup\\default=false\r\nresolution_setup=5\r\n/, '1.5x = Res3_2X = 5');
  assert.match(ini, /\[UI\]\r\ntheme=default/);
  q.applyQuality({ systemId: 'switch', emu: 'eden', exe, settings: { calidad: { switch: 'maxima' } } });
  assert.match(read(file), /resolution_setup=6\r\n/, '2x = Res2X = 6');
  q.applyQuality({ systemId: 'switch', emu: 'eden', exe, settings: {} });
  ini = read(file);
  assert.match(ini, /resolution_setup\\default=true\r\nresolution_setup=3\r\n/, 'Original: lo de fabrica de Eden (1x)');
  // Si tu Eden guarda nombres, se escribe el nombre.
  fs.writeFileSync(file, '[Renderer]\nresolution_setup=Res1X\n');
  q.applyQuality({ systemId: 'switch', emu: 'eden', exe, settings: { calidad: { switch: 'alta' } } });
  assert.match(read(file), /resolution_setup=Res3_2X/);
  assert.equal(q.EDEN_SETUP.indexOf('Res1X'), 3);
});
