'use strict';
// Localiza emuladores instalados, dice que falta para cada consola e instala los que se pueden
// descargar automaticamente (desde sus paginas o repositorios OFICIALES).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SEARCH_DEPTH = 3;

function emuRoot(dataRoot, emuId) {
  return path.join(dataRoot, 'emulators', emuId);
}

function findFileCi(dir, names, depth = 0) {
  if (depth > SEARCH_DEPTH) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const wanted = names.map((n) => n.toLowerCase());
  // Respeta el orden de preferencia de 'names'.
  for (const w of wanted) {
    const hit = entries.find((e) => e.isFile() && e.name.toLowerCase() === w);
    if (hit) return path.join(dir, hit.name);
  }
  for (const e of entries) {
    if (e.isDirectory() && !/^(cores|user|memstick|bios|cache|shaders|logs)$/i.test(e.name)) {
      const r = findFileCi(path.join(dir, e.name), names, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function defOf(catalog, id) {
  return catalog.emulators[id] || (catalog.tools && catalog.tools[id]) || null;
}

function locateEmulator(dataRoot, settings, catalog, emuId) {
  const def = defOf(catalog, emuId);
  if (!def) return null;
  const manual = settings.emuPaths && settings.emuPaths[emuId];
  if (manual && fs.existsSync(manual)) return manual;
  return findFileCi(emuRoot(dataRoot, emuId), def.exe);
}

function corePath(exePath, catalog, core) {
  const dir = path.dirname(exePath);
  return path.join(dir, catalog.emulators.retroarch.coresDir || 'cores', `${core}_libretro.dll`);
}

// Decide con que emulador se abre una consola: el elegido por el usuario, o el primero instalado.
function resolveForSystem(dataRoot, settings, catalog, systemId) {
  const sys = catalog.byId[systemId];
  if (!sys) return { ready: false, reason: 'Consola desconocida' };
  const refs = sys.emulators || [];
  const pref = settings.defaultEmu && settings.defaultEmu[systemId];
  const ordered = pref ? [...refs].sort((a, b) => (keyOf(b) === pref) - (keyOf(a) === pref)) : refs;
  const missing = [];
  for (const ref of ordered) {
    const exe = locateEmulator(dataRoot, settings, catalog, ref.emu);
    if (!exe) {
      missing.push({ emu: ref.emu, what: 'emulador' });
      continue;
    }
    if (ref.core) {
      const core = corePath(exe, catalog, ref.core);
      if (!fs.existsSync(core)) {
        missing.push({ emu: ref.emu, core: ref.core, what: 'nucleo' });
        continue;
      }
      return { ready: true, emu: ref.emu, core: ref.core, exe, corePath: core, label: `${catalog.emulators[ref.emu].name} · ${ref.core}` };
    }
    return { ready: true, emu: ref.emu, exe, label: catalog.emulators[ref.emu].name };
  }
  const first = refs[0];
  return {
    ready: false,
    emu: first && first.emu,
    core: first && first.core,
    missing,
    reason: missing.length && missing[0].what === 'nucleo'
      ? `Falta el núcleo ${missing[0].core} de RetroArch`
      : `Falta instalar ${first ? catalog.emulators[first.emu].name : 'un emulador'}`
  };
}

function keyOf(ref) {
  return ref.core ? `${ref.emu}:${ref.core}` : ref.emu;
}

function emulatorStatus(dataRoot, settings, catalog) {
  const out = {};
  for (const [id, def] of Object.entries(catalog.emulators)) {
    const exe = locateEmulator(dataRoot, settings, catalog, id);
    const entry = {
      id, name: def.name, desc: def.desc, installed: !!exe, exe,
      auto: def.install && def.install.type !== 'manual',
      homepage: def.homepage, warning: def.warning || null, setup: def.setup || null, controls: def.controls || null,
      folder: emuRoot(dataRoot, id),
      systems: catalog.systems.filter((s) => s.emulators.some((r) => r.emu === id)).map((s) => s.short)
    };
    if (id === 'retroarch' && exe) {
      entry.cores = catalog.retroarchCores.map((c) => ({ core: c, installed: fs.existsSync(corePath(exe, catalog, c)) }));
    }
    out[id] = entry;
  }
  return out;
}

// ---------------- descarga e instalacion ----------------

const UA = 'CanacaLabArcadia-Frontend/1.0 (+personal use)';

async function fetchText(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json, text/html;q=0.9, */*;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} al abrir ${url}`);
  return r.text();
}

async function downloadFile(url, dest, onProgress, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} al descargar ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  let lastEmit = 0;
  try {
    for await (const chunk of r.body) {
      done += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
      const now = Date.now();
      if (onProgress && now - lastEmit > 150) {
        lastEmit = now;
        onProgress({ done, total, pct: total ? Math.round((done / total) * 100) : null });
      }
    }
    await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(tmp); } catch { /* nada */ }
    throw e;
  }
  fs.renameSync(tmp, dest);
  if (onProgress) onProgress({ done, total, pct: 100 });
  return dest;
}

function sevenZipPath() {
  // 7zip-bin trae 7za.exe para Windows; dentro de un .asar hay que usar la copia desempaquetada.
  const bin = require('7zip-bin').path7za;
  return bin.replace('app.asar', 'app.asar.unpacked');
}

function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn(sevenZipPath(), ['x', '-y', `-o${destDir}`, archive], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(destDir) : reject(new Error(`No se pudo descomprimir (${code}): ${err.slice(0, 300)}`))));
  });
}

function pickAsset(assets, pattern, fallback) {
  const clean = assets.filter((a) => !/(pdb|debug|dbg|symbols|arm64|aarch64)/i.test(a.name));
  const re = new RegExp(pattern, 'i');
  let hit = clean.find((a) => re.test(a.name));
  if (!hit && fallback) {
    const re2 = new RegExp(fallback, 'i');
    hit = clean.find((a) => re2.test(a.name));
  }
  return hit || null;
}

async function resolveDownloadUrl(def, fetchImpl = fetch, apiBase = 'https://api.github.com') {
  const inst = def.install || {};
  if (inst.type === 'github') {
    let release;
    try {
      release = JSON.parse(await fetchText(`${apiBase}/repos/${inst.repo}/releases/latest`, fetchImpl));
    } catch {
      release = null;
    }
    let asset = release && release.assets ? pickAsset(release.assets, inst.asset, inst.assetFallback) : null;
    if (!asset) {
      // Algunos proyectos solo publican pre-releases: revisamos las ultimas 10.
      const list = JSON.parse(await fetchText(`${apiBase}/repos/${inst.repo}/releases?per_page=10`, fetchImpl));
      for (const rel of list) {
        asset = pickAsset(rel.assets || [], inst.asset, inst.assetFallback);
        if (asset) { release = rel; break; }
      }
    }
    if (!asset) throw new Error(`No encontré un archivo para Windows en ${inst.repo}`);
    return { url: asset.browser_download_url, name: asset.name, version: release && (release.tag_name || release.name) };
  }
  if (inst.type === 'url') {
    return { url: inst.url, name: path.basename(new URL(inst.url).pathname) };
  }
  if (inst.type === 'html') {
    let m = null;
    try {
      const html = await fetchText(inst.page, fetchImpl);
      m = html.match(new RegExp(inst.pattern, 'i'));
    } catch (e) {
      if (!inst.fallbackUrl) throw e;
    }
    // Si la pagina cambia o no responde, se usa la ultima version conocida del sitio oficial.
    if (!m && inst.fallbackUrl) return { url: inst.fallbackUrl, name: path.basename(new URL(inst.fallbackUrl).pathname) };
    if (!m) throw new Error(`No encontré el enlace de descarga en ${inst.page}`);
    const url = new URL(m[0].replace(/&amp;/g, '&'), inst.page).toString();
    return { url, name: path.basename(new URL(url).pathname) };
  }
  throw new Error('Este emulador se instala a mano (por seguridad o por licencia).');
}

const LIBRETRO = 'https://buildbot.libretro.com';

async function resolveRetroArch(fetchImpl = fetch, base = LIBRETRO) {
  try {
    const html = await fetchText(`${base}/stable/`, fetchImpl);
    const versions = [...html.matchAll(/href="(\d+)\.(\d+)\.(\d+)\/"/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    if (versions.length) {
      const v = versions[0].join('.');
      return { url: `${base}/stable/${v}/windows/x86_64/RetroArch.7z`, name: 'RetroArch.7z', version: v };
    }
  } catch { /* usamos nightly */ }
  return { url: `${base}/nightly/windows/x86_64/RetroArch.7z`, name: 'RetroArch.7z', version: 'nightly' };
}

function coreUrl(core, base = LIBRETRO) {
  return `${base}/nightly/windows/x86_64/latest/${core}_libretro.dll.zip`;
}

async function installRetroArchCores(exe, cores, tmpDir, onProgress, fetchImpl = fetch, base = LIBRETRO) {
  const coresDir = path.join(path.dirname(exe), 'cores');
  fs.mkdirSync(coresDir, { recursive: true });
  const failed = [];
  for (let i = 0; i < cores.length; i++) {
    const core = cores[i];
    if (fs.existsSync(path.join(coresDir, `${core}_libretro.dll`))) continue;
    onProgress && onProgress({ phase: `Núcleo ${core} (${i + 1}/${cores.length})`, pct: Math.round((i / cores.length) * 100) });
    const zip = path.join(tmpDir, `${core}.zip`);
    try {
      await downloadFile(coreUrl(core, base), zip, null, fetchImpl);
      await extractArchive(zip, coresDir);
    } catch (e) {
      failed.push(core);
    } finally {
      try { fs.unlinkSync(zip); } catch { /* nada */ }
    }
  }
  return failed;
}

async function installEmulator(dataRoot, catalog, emuId, onProgress, deps = {}) {
  const def = defOf(catalog, emuId);
  if (!def) throw new Error('Emulador desconocido');
  const fetchImpl = deps.fetch || fetch;
  const dest = emuRoot(dataRoot, emuId);
  const tmpDir = path.join(dataRoot, 'emulators', '_descargas');
  fs.mkdirSync(tmpDir, { recursive: true });
  const step = (phase, pct = null) => onProgress && onProgress({ emu: emuId, phase, pct });

  step('Buscando la versión más reciente...');
  const target = def.install.type === 'retroarch'
    ? await resolveRetroArch(fetchImpl, deps.libretroBase)
    : await resolveDownloadUrl(def, fetchImpl, deps.githubApi);

  const archive = path.join(tmpDir, target.name);
  step(`Descargando ${def.name} ${target.version || ''}`.trim(), 0);
  await downloadFile(target.url, archive, (p) => step(`Descargando ${def.name}`, p.pct), fetchImpl);
  step('Descomprimiendo...', null);
  await extractArchive(archive, dest);
  try { fs.unlinkSync(archive); } catch { /* nada */ }

  const exe = findFileCi(dest, def.exe);
  if (!exe) throw new Error(`Se descargó ${def.name} pero no encontré ${def.exe[0]}. Revisa la carpeta ${dest}`);

  // Modo portable: la configuracion del emulador vive junto a el, dentro de la carpeta de CanacaLabArcadia.
  for (const f of def.portableFiles || []) {
    const pf = path.join(path.dirname(exe), f);
    if (!fs.existsSync(pf)) fs.writeFileSync(pf, '');
  }

  let failedCores = [];
  if (emuId === 'retroarch') {
    failedCores = await installRetroArchCores(exe, catalog.retroarchCores, tmpDir, (p) => step(p.phase, p.pct), fetchImpl, deps.libretroBase);
  }
  step('Listo', 100);
  return { exe, version: target.version || null, failedCores };
}

// Abre el emulador sin juego (para configurar BIOS, firmware, llaves o controles la primera vez).
function openEmulatorGui(exe) {
  const p = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
}

module.exports = {
  locateEmulator, defOf, resolveForSystem, emulatorStatus, installEmulator, openEmulatorGui,
  resolveDownloadUrl, resolveRetroArch, pickAsset, downloadFile, extractArchive, findFileCi, corePath, emuRoot, keyOf,
  installRetroArchCores, coreUrl
};
