'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const { CloudService, parseFolderId, mapFolderToSystem, groupUnits, loadCloud } = require('../src/main/cloud');
const emus = require('../src/main/emulators');

const catalog = loadCatalog();
const FOLDER = '1FakeFolderIdParaPruebas_abcdefgh';
const fakeExe = path.join(__dirname, 'fake-rclone.js');
fs.chmodSync(fakeExe, 0o755);
const sevenZip = require('7zip-bin').path7za;
try { fs.chmodSync(sevenZip, 0o755); } catch { /* ok */ }

test('parseFolderId acepta enlace, open?id y id pelon', () => {
  assert.equal(parseFolderId(`https://drive.google.com/drive/folders/${FOLDER}`), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/drive/u/1/folders/${FOLDER}?usp=sharing`), FOLDER);
  assert.equal(parseFolderId(`https://drive.google.com/open?id=${FOLDER}`), FOLDER);
  assert.equal(parseFolderId(FOLDER), FOLDER);
  assert.equal(parseFolderId('https://example.com/nada'), null);
});

test('las 20 subcarpetas de tu Drive se asignan a la consola correcta', () => {
  const cfg = loadCloud(h.tmpDir());
  const expect = {
    'Nintendo Switch': 'switch', 'Sega Genesis': 'genesis', PS2: 'ps2', PS1: 'ps1', PS4: 'ps4', BIOS: 'bios',
    'Game Boy Advance': 'gba', 'Game Boy Color': 'gb', 'Game Boy': 'gb', Arcade: 'mame', PC: null,
    'Nintendo DS': 'nds', 'Nintendo 64': 'n64', 'Super Nintendo': 'snes', NES: 'nes', 'Neo Geo': 'neogeo',
    MAME: 'mame', 'Xbox 360': 'xbox360', Xbox: 'xbox', PSP: 'psp',
    // Carpetas que podrias agregar despues:
    PS3: 'ps3', GameCube: 'gamecube', Wii: 'wii'
  };
  for (const [name, sys] of Object.entries(expect)) assert.equal(mapFolderToSystem(name, cfg, catalog), sys, name);
});

test('agrupado: cue+bin, multidisco m3u, carpeta de juego, comprimidos, basura fuera', () => {
  const f = (p, size = 10) => ({ Path: p, Name: path.basename(p), Size: size, IsDir: false });
  const ps1 = groupUnits([
    f('Crash (USA).cue'), f('Crash (USA).bin', 500),
    f('FF7 (USA).m3u'), f('FF7 (USA) (Disc 1).cue'), f('FF7 (USA) (Disc 1).bin', 700), f('FF7 (USA) (Disc 2).cue'), f('FF7 (USA) (Disc 2).bin', 700),
    f('Spyro (USA).chd', 300), f('leeme.txt'), f('portada.jpg')
  ], catalog.byId.ps1);
  assert.deepEqual(ps1.map((u) => u.name), ['Crash (USA).cue', 'FF7 (USA).m3u', 'Spyro (USA).chd']);
  assert.equal(ps1.find((u) => u.name === 'FF7 (USA).m3u').files.length, 5);
  assert.equal(ps1.find((u) => u.name === 'Crash (USA).cue').size, 510);

  const ps4 = groupUnits([f('CUSA00900/eboot.bin', 100), f('CUSA00900/sce_sys/param.sfo', 5)], catalog.byId.ps4);
  assert.deepEqual(ps4.map((u) => [u.name, u.kind, u.size]), [['CUSA00900', 'dir', 105]]);

  const ps2 = groupUnits([f('Okami (USA).7z', 900), f('Okami (USA).iso', 4000)], catalog.byId.ps2);
  assert.equal(ps2.length, 2, 'el .7z se ofrece para descargar y descomprimir');
});

function buildFakeDrive() {
  const drive = h.tmpDir('drive-');
  const root = path.join(drive, FOLDER);
  const put = (rel, buf) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  };
  put('PS2/Okami (USA).iso', h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_215.15;1' }));
  // Un juego de PS2 comprimido en .7z (PCSX2 no lee .7z: hay que descomprimirlo).
  const stage = h.tmpDir('stage-');
  fs.writeFileSync(path.join(stage, 'Ico (USA).iso'), h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SCUS_971.13;1' }));
  execFileSync(sevenZip, ['a', '-t7z', path.join(root, 'PS2', 'Ico (USA).7z'), 'Ico (USA).iso'], { cwd: stage, stdio: 'ignore' });
  put('PS1/Spyro (USA).bin', h.toRawMode2(h.buildIso9660({ 'SYSTEM.CNF': 'BOOT = cdrom:\\SCUS_942.28;1' })));
  put('PS1/Spyro (USA).cue', 'FILE "Spyro (USA).bin" BINARY\r\n TRACK 01 MODE2/2352\r\n');
  put('PS1/notas.txt', 'x');
  put('PS4/CUSA00900/eboot.bin', Buffer.alloc(64));
  put('PS4/CUSA00900/sce_sys/param.sfo', h.buildSfo({ TITLE: 'Bloodborne', TITLE_ID: 'CUSA00900' }));
  put('BIOS/neogeo.zip', h.buildZip(['sp-s2.sp1', '000-lo.lo']));
  put('BIOS/scph5501.bin', Buffer.alloc(32));
  put('Neo Geo/mslug.zip', h.buildZip(['201-p1.p1', '201-c1.c1']));
  fs.mkdirSync(path.join(root, 'PC'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Xbox 360'), { recursive: true });
  return drive;
}

test('flujo completo con Google Drive simulado: conectar, explorar, descargar', async () => {
  const drive = buildFakeDrive();
  process.env.FAKE_DRIVE = drive;
  const dataRoot = h.withCloudFolder(h.tmpDir('biblio-'));
  const cloud = new CloudService({
    getDataRoot: () => dataRoot,
    getCatalog: () => catalog,
    getRcloneExe: () => fakeExe,
    extract: (a, d) => emus.extractArchive(a, d)
  });

  // Sin cuenta: avisa que hay que conectar.
  await assert.rejects(cloud.folders(), (e) => e.code === 'NO_ACCOUNT');
  let link = null;
  await cloud.connectAccount({ onLink: (u) => { link = u; } });
  assert.match(link, /^http:\/\/127\.0\.0\.1:53682\/auth\?state=/);
  const st = await cloud.status();
  assert.equal(st.cuentas.length, 1);
  assert.equal(st.cuentas[0].remoto, 'google1');
  assert.equal(st.cuentas[0].nombre, 'jugadora@example.com');
  assert.equal(st.cuentas[0].activa, true);
  assert.equal(st.carpetas[0].enlace.includes(FOLDER), true, 'tu carpeta viene configurada de fabrica');

  const { folders } = await cloud.folders();
  const bySys = Object.fromEntries(folders.map((f) => [f.name, f.system]));
  assert.equal(bySys.PS2, 'ps2');
  assert.equal(bySys.BIOS, 'bios');
  assert.equal(bySys.PC, null);
  assert.equal(folders.find((f) => f.name === 'PC').supported, false);

  const ps2 = await cloud.items(undefined, 'PS2', 'ps2');
  assert.deepEqual(ps2.items.map((i) => i.name).sort(), ['Ico (USA).7z', 'Okami (USA).iso']);
  assert.ok(ps2.items.every((i) => !i.downloaded));
  const ps1 = await cloud.items(undefined, 'PS1', 'ps1');
  assert.deepEqual(ps1.items.map((i) => i.name), ['Spyro (USA).cue'], 'el .bin viaja con su .cue y el .txt se ignora');
  const ps4 = await cloud.items(undefined, 'PS4', 'ps4');
  const bios = await cloud.items(undefined, 'BIOS', 'bios');

  const done = [];
  const progress = [];
  cloud.on('done', (d) => done.push(d));
  cloud.on('progress', (p) => progress.push(p));
  const finished = new Promise((resolve) => {
    const check = () => { if (done.length === 6) resolve(); };
    cloud.on('done', check);
  });
  const job = (sys, folder, u) => ({ id: u.id, sourceId: ps2.source.id, folder, system: sys, name: u.name, kind: u.kind, path: u.path, files: u.files, size: u.size });
  const n = cloud.enqueue([
    ...ps2.items.map((u) => job('ps2', 'PS2', u)),
    ...ps1.items.map((u) => job('ps1', 'PS1', u)),
    ...ps4.items.map((u) => job('ps4', 'PS4', u)),
    ...bios.items.map((u) => job('bios', 'BIOS', u))
  ]);
  assert.equal(n, 6);
  assert.equal(cloud.enqueue([job('ps2', 'PS2', ps2.items[0])]), 0, 'no se encola dos veces');
  await finished;
  assert.ok(done.every((d) => d.ok), JSON.stringify(done));
  assert.ok(progress.length > 0);

  const roms = (p) => path.join(dataRoot, 'roms', p);
  assert.ok(fs.existsSync(roms('ps2/Okami (USA).iso')));
  assert.ok(fs.existsSync(roms('ps2/Ico (USA).iso')), 'el .7z se descomprimio');
  assert.ok(!fs.existsSync(roms('ps2/Ico (USA).7z')), 'y el comprimido se borro');
  assert.ok(fs.existsSync(roms('ps1/Spyro (USA).cue')) && fs.existsSync(roms('ps1/Spyro (USA).bin')));
  assert.ok(fs.existsSync(roms('ps4/CUSA00900/eboot.bin')));
  assert.ok(fs.existsSync(path.join(dataRoot, 'bios', 'scph5501.bin')));
  assert.ok(fs.existsSync(roms('neogeo/neogeo.zip')), 'neogeo.zip tambien queda junto a los juegos de Neo Geo');
  assert.ok(fs.existsSync(path.join(dataRoot, 'bios', 'fbneo', 'neogeo.zip')), 'y en bios/fbneo, que es donde lo busca FBNeo');
  assert.ok(fs.existsSync(roms('mame/neogeo.zip')), 'y junto a los juegos de MAME');

  const again = await cloud.items(undefined, 'PS2', 'ps2');
  assert.ok(again.items.every((i) => i.downloaded), 'ya descargados (incluye el .7z descomprimido)');

  // Parametrizable: segunda carpeta en otra cuenta.
  await cloud.connectAccount();
  cloud.saveSource({ nombre: 'Respaldo en mi otra cuenta', enlace: `https://drive.google.com/drive/folders/${FOLDER}`, cuenta: 'google2' });
  const st2 = await cloud.status();
  assert.equal(st2.cuentas.length, 2);
  assert.equal(st2.carpetas.length, 2);
  assert.equal(st2.carpetas[1].cuenta, 'google2');
  assert.throws(() => cloud.saveSource({ nombre: 'x', enlace: 'https://example.com' }), /enlace/);
  const saved = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config', 'nube.json'), 'utf8'));
  assert.equal(saved.carpetas.length, 2);

  await cloud.removeAccount('google2');
  const st3 = await cloud.status();
  assert.equal(st3.cuentas.length, 1);
  assert.equal(st3.carpetas[1].cuenta, '', 'la carpeta queda usando la cuenta principal');
});

test('error de inicio de sesion se reporta claro', async () => {
  process.env.FAKE_DRIVE = h.tmpDir();
  process.env.FAKE_AUTH_FAIL = '1';
  const dataRoot = h.tmpDir();
  const cloud = new CloudService({ getDataRoot: () => dataRoot, getCatalog: () => catalog, getRcloneExe: () => fakeExe });
  await assert.rejects(cloud.connectAccount(), /No se pudo conectar la cuenta/);
  delete process.env.FAKE_AUTH_FAIL;
  const none = new CloudService({ getDataRoot: () => dataRoot, getCatalog: () => catalog, getRcloneExe: () => null });
  await assert.rejects(none.connectAccount(), (e) => e.code === 'NO_RCLONE');
});
