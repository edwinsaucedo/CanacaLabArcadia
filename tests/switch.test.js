'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const h = require('./helpers');
const emus = require('../src/main/emulators');
const { edenStatus, installEdenFiles, findSwitchSources, edenDataDir } = require('../src/main/switchsetup');
const { loadCatalog } = require('../src/main/catalog');

const sevenZip = require('7zip-bin').path7za;
try { fs.chmodSync(sevenZip, 0o755); } catch { /* ok */ }

function zipOf(target, files) {
  const stage = h.tmpDir('stage-');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), content);
  }
  execFileSync(sevenZip, ['a', '-tzip', target, '.'], { cwd: stage, stdio: 'ignore' });
}

function setup() {
  const root = h.tmpDir('switch-');
  const bios = path.join(root, 'bios');
  fs.mkdirSync(bios, { recursive: true });
  const eden = path.join(root, 'emulators', 'eden');
  fs.mkdirSync(eden, { recursive: true });
  const exe = path.join(eden, 'eden.exe');
  fs.writeFileSync(exe, '');
  const appData = path.join(root, 'AppData', 'Roaming');
  return { root, bios, exe, appData };
}

test('Switch: avisa que faltan llaves y firmware si no hay nada en la carpeta BIOS', () => {
  const { root, exe, appData } = setup();
  const st = edenStatus({ exe, dataRoot: root, appDataDir: appData });
  assert.equal(st.ok, false);
  assert.equal(st.canInstall, false);
  assert.match(st.message, /las llaves \(prod\.keys\) y el firmware/);
});

test('Switch: instala solas las llaves y el firmware de tus .zip (como los de tu Drive)', async () => {
  const { root, bios, exe, appData } = setup();
  // Mismo estilo que tus archivos: "ProdKeys.-v22.5.0.zip" y dos firmwares iguales.
  zipOf(path.join(bios, 'ProdKeys.-v22.5.0.zip'), { 'prod.keys': 'master_key_00 = 00', 'title.keys': 'x = y' });
  const ncas = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`Firmware 23.0.1/${i.toString(16).padStart(32, '0')}.nca`, `nca${i}`]));
  zipOf(path.join(bios, 'Firmware_switch.23.0.1.zip'), ncas);
  zipOf(path.join(bios, 'FirmwareSwitch 23.0.1.zip'), ncas);
  const src = findSwitchSources(root);
  assert.ok(src.keysZip && src.firmwareZip);

  const before = edenStatus({ exe, dataRoot: root, appDataDir: appData });
  assert.equal(before.canInstall, true);
  const r = await installEdenFiles({ exe, dataRoot: root, appDataDir: appData, extract: (a, d) => emus.extractArchive(a, d) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.installed, ['llaves', 'firmware']);
  const dir = edenDataDir(exe, appData);
  assert.equal(dir, path.join(appData, 'eden'));
  assert.ok(fs.existsSync(path.join(dir, 'keys', 'prod.keys')));
  assert.ok(fs.existsSync(path.join(dir, 'keys', 'title.keys')));
  assert.equal(fs.readdirSync(path.join(dir, 'nand', 'system', 'Contents', 'registered')).length, 30);
  assert.equal(edenStatus({ exe, dataRoot: root, appDataDir: appData }).ok, true);
  // Segunda vez: nada que hacer.
  assert.deepEqual((await installEdenFiles({ exe, dataRoot: root, appDataDir: appData, extract: (a, d) => emus.extractArchive(a, d) })).installed, []);
});

test('Switch: prod.keys suelto y Eden portable (carpeta user junto al .exe)', async () => {
  const { root, bios, exe, appData } = setup();
  fs.mkdirSync(path.join(path.dirname(exe), 'user'));
  fs.writeFileSync(path.join(bios, 'prod.keys'), 'k');
  zipOf(path.join(bios, 'firmware.zip'), Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`${i}.nca`, 'n'])));
  const r = await installEdenFiles({ exe, dataRoot: root, appDataDir: appData, extract: (a, d) => emus.extractArchive(a, d) });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(path.dirname(exe), 'user', 'keys', 'prod.keys')));
});

test('Switch: un .zip que no es firmware se reporta claro', async () => {
  const { root, bios, exe, appData } = setup();
  fs.writeFileSync(path.join(bios, 'prod.keys'), 'k');
  zipOf(path.join(bios, 'Firmware raro.zip'), { 'leeme.txt': 'nada' });
  await assert.rejects(installEdenFiles({ exe, dataRoot: root, appDataDir: appData, extract: (a, d) => emus.extractArchive(a, d) }), /no parece un firmware/);
});

test('Eden se descarga del sitio oficial (y si la pagina cambia, de la ultima version conocida)', async () => {
  const catalog = loadCatalog();
  const def = catalog.emulators.eden;
  assert.equal(def.install.type, 'html');
  const page = '<a href="https://stable.eden-emu.dev/v0.3.0/Eden-Windows-v0.3.0-amd64-clang-pgo.zip">PGO</a> <a href="https://stable.eden-emu.dev/v0.2.1/Eden-Windows-v0.2.1-amd64-clang-pgo.zip">old</a>';
  const ok = await emus.resolveDownloadUrl(def, async () => ({ ok: true, status: 200, text: async () => page }));
  assert.equal(ok.url, 'https://stable.eden-emu.dev/v0.3.0/Eden-Windows-v0.3.0-amd64-clang-pgo.zip');
  const down = await emus.resolveDownloadUrl(def, async () => { throw new Error('sin red'); });
  assert.equal(down.url, def.install.fallbackUrl);
  assert.match(down.url, /^https:\/\/stable\.eden-emu\.dev\//);
});
