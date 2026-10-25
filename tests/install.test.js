'use strict';
// Prueba el instalador contra un servidor local que imita GitHub y el buildbot de libretro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const emus = require('../src/main/emulators');

const catalog = loadCatalog();
const sevenZip = require('7zip-bin').path7za;
try { fs.chmodSync(sevenZip, 0o755); } catch { /* ya ejecutable */ }

function make7z(outFile, files) {
  const stage = h.tmpDir('stage-');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(stage, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const fmt = outFile.endsWith('.zip') ? '-tzip' : '-t7z';
  execFileSync(sevenZip, ['a', fmt, outFile, '.'], { cwd: stage, stdio: 'ignore' });
  fs.rmSync(stage, { recursive: true, force: true });
}

test('instala PCSX2 (GitHub), Dolphin (pagina HTML) y RetroArch con nucleos', async () => {
  const files = h.tmpDir('srv-');
  make7z(path.join(files, 'pcsx2-v2.6.0-windows-x64-Qt.7z'), { 'pcsx2-qt.exe': 'exe', 'resources/x.txt': 'r' });
  make7z(path.join(files, 'dolphin-2509-x64.7z'), { 'Dolphin-x64/Dolphin.exe': 'exe' });
  make7z(path.join(files, 'RetroArch.7z'), { 'RetroArch-Win64/retroarch.exe': 'exe' });
  for (const core of catalog.retroarchCores) {
    if (core === 'mame') continue; // simula un nucleo que no se pudo bajar
    make7z(path.join(files, `${core}_libretro.dll.zip`), { [`${core}_libretro.dll`]: 'dll' });
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const base = `http://127.0.0.1:${server.address().port}`;
    if (u.pathname === '/repos/PCSX2/pcsx2/releases/latest') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({
        tag_name: 'v2.6.0',
        assets: [
          { name: 'pcsx2-v2.6.0-windows-x64-Qt-symbols.7z', browser_download_url: `${base}/nope` },
          { name: 'pcsx2-v2.6.0-linux-appimage-x64-Qt.AppImage', browser_download_url: `${base}/nope` },
          { name: 'pcsx2-v2.6.0-windows-x64-Qt.7z', browser_download_url: `${base}/files/pcsx2-v2.6.0-windows-x64-Qt.7z` }
        ]
      }));
    }
    if (u.pathname === '/download/') {
      return res.end(`<a href="https://dl.dolphin-emu.org/releases/2509/dolphin-2509-x64.7z">Windows x64</a>`);
    }
    if (u.pathname === '/stable/') return res.end('<a href="1.19.1/">1.19.1/</a><a href="1.21.0/">1.21.0/</a><a href="1.20.0/">1.20.0/</a>');
    if (u.pathname === '/stable/1.21.0/windows/x86_64/RetroArch.7z') return fs.createReadStream(path.join(files, 'RetroArch.7z')).pipe(res);
    const core = u.pathname.match(/^\/nightly\/windows\/x86_64\/latest\/(.+)$/);
    if (core && fs.existsSync(path.join(files, core[1]))) return fs.createReadStream(path.join(files, core[1])).pipe(res);
    const f = u.pathname.match(/^\/files\/(.+)$/);
    if (f && fs.existsSync(path.join(files, f[1]))) {
      res.setHeader('content-length', fs.statSync(path.join(files, f[1])).size);
      return fs.createReadStream(path.join(files, f[1])).pipe(res);
    }
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Redirige las URLs reales al servidor local.
  const fakeFetch = (url, opts) => {
    const mapped = url
      .replace('https://dl.dolphin-emu.org/releases/2509/', `${base}/files/`)
      .replace('https://dolphin-emu.org', base);
    return fetch(mapped, opts);
  };

  const root = h.tmpDir();
  const progress = [];
  const r1 = await emus.installEmulator(root, catalog, 'pcsx2', (p) => progress.push(p), { fetch: fakeFetch, githubApi: base });
  assert.ok(r1.exe.endsWith('pcsx2-qt.exe'));
  assert.equal(r1.version, 'v2.6.0');
  assert.ok(fs.existsSync(path.join(path.dirname(r1.exe), 'portable.ini')));
  assert.ok(progress.some((p) => p.pct === 100));

  const r2 = await emus.installEmulator(root, catalog, 'dolphin', null, { fetch: fakeFetch });
  assert.ok(r2.exe.endsWith('Dolphin.exe'));

  const r3 = await emus.installEmulator(root, catalog, 'retroarch', null, { fetch: fakeFetch, libretroBase: base });
  assert.equal(r3.version, '1.21.0', 'elige la version estable mas alta');
  assert.deepEqual(r3.failedCores, ['mame']);
  assert.ok(fs.existsSync(path.join(path.dirname(r3.exe), 'cores', 'snes9x_libretro.dll')));

  const status = emus.emulatorStatus(root, { emuPaths: {} }, catalog);
  assert.equal(status.pcsx2.installed, true);
  assert.equal(status.xenia.installed, false);
  assert.equal(status.eden.auto, true, 'Eden se descarga de su sitio oficial');
  assert.equal(status.ryujinx.auto, false, 'Ryujinx sigue siendo a mano');
  assert.ok(status.retroarch.cores.find((c) => c.core === 'snes9x').installed);

  await assert.rejects(emus.installEmulator(root, catalog, 'ryujinx', null, { fetch: fakeFetch }), /a mano/);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(files, { recursive: true, force: true });
});

test('pickAsset ignora simbolos, ARM y debug', () => {
  const a = emus.pickAsset([
    { name: 'xemu-win-x86_64-release-pdb.zip' },
    { name: 'xemu-win-aarch64-release.zip' },
    { name: 'xemu-win-x86_64-release.zip' }
  ], catalog.emulators.xemu.install.asset);
  assert.equal(a.name, 'xemu-win-x86_64-release.zip');
  const s = emus.pickAsset([{ name: 'shadps4-win64-qt-0.18.0.zip' }], catalog.emulators.shadps4.install.asset, catalog.emulators.shadps4.install.assetFallback);
  assert.equal(s.name, 'shadps4-win64-qt-0.18.0.zip');
});
