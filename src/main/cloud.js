'use strict';
// Nube: descarga juegos desde carpetas de Google Drive (tuyas o compartidas contigo) usando rclone,
// la herramienta libre y oficial que ya sabe iniciar sesion con Google, manejar archivos grandes y reanudar.
// Todo es parametrizable en <biblioteca>\config\nube.json: varias cuentas y varias carpetas.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { hintFromPath } = require('./detect');
const { readJsonSafe, writeJsonAtomic } = require('./store');
const { attachSwitchExtras } = require('./nsp');
const { titleFor, findCover, withoutCopyPrefix } = require('./scanner');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config', 'nube.default.json');
const COMPANION_EXT = new Set(['.bin', '.img', '.sub', '.cue', '.ccd', '.m3u', '.dkey', '.iso']);
const ARCHIVE_EXT = new Set(['.zip', '.7z', '.rar']);
const IGNORE_EXT = new Set(['.txt', '.nfo', '.jpg', '.jpeg', '.png', '.url', '.lnk', '.ini', '.md', '.pdf', '.docx', '.xlsx', '.gdoc']);

// ---------------------------------------------------------------- configuracion

function cloudPath(dataRoot) {
  return path.join(dataRoot, 'config', 'nube.json');
}

// Lista de todo lo que hay en tus carpetas de Drive (se guarda para abrir rapido y sin internet).
function indexPath(dataRoot) {
  return path.join(dataRoot, 'config', 'nube-indice.json');
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    _comentario: cfg._comentario,
    cuentas: Array.isArray(cfg.cuentas) ? cfg.cuentas.filter((c) => c && c.remoto) : [],
    carpetas: Array.isArray(cfg.carpetas) ? cfg.carpetas.filter((c) => c && c.enlace) : [],
    mapeo: cfg.mapeo && typeof cfg.mapeo === 'object' ? cfg.mapeo : {},
    descomprimir: cfg.descomprimir !== false
  };
}

function loadCloud(dataRoot, defaultFile = DEFAULT_FILE) {
  const file = cloudPath(dataRoot);
  if (!fs.existsSync(file)) {
    const defaults = readJsonSafe(defaultFile, {});
    writeJsonAtomic(file, normalizeConfig(defaults));
  }
  return normalizeConfig(readJsonSafe(file, {}));
}

function saveCloud(dataRoot, cfg) {
  const clean = normalizeConfig(cfg);
  writeJsonAtomic(cloudPath(dataRoot), clean);
  return clean;
}

// Acepta el enlace completo de Drive, el enlace "open?id=" o el id pelon.
function parseFolderId(link) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/^([A-Za-z0-9_-]{10,})$/);
  return m ? m[1] : null;
}

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carpeta';
}

// Decide a que consola va una subcarpeta: primero el mapeo del usuario, luego el nombre.
function mapFolderToSystem(name, cfg, catalog) {
  const lower = name.trim().toLowerCase();
  for (const [k, v] of Object.entries(cfg.mapeo || {})) {
    if (k.trim().toLowerCase() === lower) return v === null ? null : String(v);
  }
  if (/^bios$/i.test(name.trim())) return 'bios';
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const s of catalog.systems) {
    if ([s.id, s.short, s.name].some((x) => norm(x) === norm(name))) return s.id;
  }
  const hint = hintFromPath(name);
  return hint && catalog.byId[hint] ? hint : null;
}

// ---------------------------------------------------------------- rclone

class Rclone {
  constructor({ exe, configPath }) {
    this.exe = exe;
    this.configPath = configPath;
  }

  base() {
    return ['--config', this.configPath];
  }

  run(args, { timeoutMs = 120000, onStderrLine, onStdoutLine, track } = {}) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      const p = spawn(this.exe, [...args, ...this.base()], { windowsHide: true });
      if (track) track(p);
      let out = '';
      let err = '';
      let errBuf = '';
      let outBuf = '';
      const timer = timeoutMs ? setTimeout(() => { try { p.kill(); } catch { /* nada */ } }, timeoutMs) : null;
      p.stdout.on('data', (d) => {
        out += d;
        if (onStdoutLine) {
          outBuf += d;
          let i;
          while ((i = outBuf.indexOf('\n')) >= 0) { onStdoutLine(outBuf.slice(0, i)); outBuf = outBuf.slice(i + 1); }
        }
      });
      p.stderr.on('data', (d) => {
        err += d;
        if (onStderrLine) {
          errBuf += d;
          let i;
          while ((i = errBuf.indexOf('\n')) >= 0) { onStderrLine(errBuf.slice(0, i)); errBuf = errBuf.slice(i + 1); }
        }
      });
      p.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
      p.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (onStderrLine && errBuf) onStderrLine(errBuf);
        if (onStdoutLine && outBuf) onStdoutLine(outBuf);
        resolve({ code, signal, stdout: out, stderr: err });
      });
    });
  }

  static errorText(res) {
    const lines = String(res.stderr || '').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i]);
        if (j.level === 'error' || j.level === 'critical') return j.msg;
      } catch {
        if (/error|fail|denied|not found/i.test(lines[i])) return lines[i].replace(/^.*?(ERROR|CRITICAL)\s*:\s*/, '');
      }
    }
    return lines.slice(-1)[0] || `rclone termino con codigo ${res.code}`;
  }

  async listRemotes() {
    const r = await this.run(['listremotes', '--long'], { timeoutMs: 20000 });
    if (r.code !== 0) return [];
    return r.stdout.split(/\r?\n/).map((l) => l.match(/^(.+?):\s+(\S+)/)).filter(Boolean).map((m) => ({ name: m[1].trim(), type: m[2] }));
  }

  // Abre el navegador para iniciar sesion con Google. onLink recibe el enlace por si el navegador no abre solo.
  async createRemote(name, { onLink, track, timeoutMs = 10 * 60 * 1000 } = {}) {
    const linkRe = /(https?:\/\/127\.0\.0\.1:\d+\/auth\?state=[^\s"\\]+)/;
    const seen = (line) => {
      const m = line.match(linkRe);
      if (m && onLink) onLink(m[1]);
    };
    const r = await this.run(['config', 'create', name, 'drive', 'scope=drive.readonly'], {
      timeoutMs, onStderrLine: seen, onStdoutLine: seen, track
    });
    if (r.code !== 0) throw new Error(`No se pudo conectar la cuenta: ${Rclone.errorText(r)}`);
    return true;
  }

  async userEmail(name) {
    try {
      const r = await this.run(['config', 'userinfo', `${name}:`, '--json'], { timeoutMs: 20000 });
      if (r.code !== 0) return null;
      const j = JSON.parse(r.stdout);
      return j.Email || j.email || j.Username || null;
    } catch {
      return null;
    }
  }

  async deleteRemote(name) {
    await this.run(['config', 'delete', name], { timeoutMs: 20000 });
  }

  async lsjson(remote, folderId, subPath = '', { recursive = false, dirsOnly = false, filesOnly = false } = {}) {
    const args = ['lsjson', `${remote}:${subPath}`, '--drive-root-folder-id', folderId, '--no-mimetype', '--fast-list'];
    if (recursive) args.push('-R');
    if (dirsOnly) args.push('--dirs-only');
    if (filesOnly) args.push('--files-only');
    const r = await this.run(args, { timeoutMs: 180000 });
    if (r.code !== 0) throw new Error(Rclone.errorText(r));
    try {
      return JSON.parse(r.stdout || '[]');
    } catch {
      throw new Error('Respuesta de Google Drive no valida');
    }
  }

  // Copia un archivo o una carpeta remota a destDir. Reporta progreso con los stats JSON de rclone.
  copy(remote, folderId, srcPath, destDir, { onProgress, track } = {}) {
    const args = [
      'copy', `${remote}:${srcPath}`, destDir,
      '--drive-root-folder-id', folderId,
      '--drive-acknowledge-abuse',
      '--use-json-log', '--stats', '1s', '--stats-log-level', 'NOTICE',
      '--transfers', '4', '--retries', '5', '--low-level-retries', '20'
    ];
    return this.run(args, {
      timeoutMs: 0,
      track,
      onStderrLine: (line) => {
        if (!onProgress) return;
        try {
          const j = JSON.parse(line);
          if (j.stats) onProgress({ bytes: j.stats.bytes || 0, total: j.stats.totalBytes || 0, speed: j.stats.speed || 0, eta: j.stats.eta ?? null });
        } catch { /* linea que no es JSON */ }
      }
    });
  }
}

// ---------------------------------------------------------------- agrupar juegos

// Convierte la lista plana de archivos de una subcarpeta en "juegos":
//  - Una subcarpeta interna es un juego completo (carpetas de PS3/PS4/Xbox 360 o juegos con varios archivos).
//  - Un .cue/.ccd/.m3u se lleva sus .bin/.img y discos (los que empiezan con su mismo nombre).
function groupUnits(files, system) {
  const units = new Map();
  const loose = [];
  for (const f of files) {
    if (f.IsDir) continue;
    const parts = f.Path.split('/');
    if (parts.length > 1) {
      const key = `dir:${parts[0]}`;
      const u = units.get(key) || { key, name: parts[0], kind: 'dir', path: parts[0], files: [], size: 0 };
      u.files.push(f.Path);
      u.size += Math.max(0, f.Size || 0);
      units.set(key, u);
    } else {
      loose.push(f);
    }
  }
  const sysExt = new Set(system ? system.ext : []);
  const isBios = !system;
  const relevant = loose.filter((f) => {
    const ext = path.extname(f.Name).toLowerCase();
    if (IGNORE_EXT.has(ext)) return false;
    if (isBios) return true;
    return sysExt.has(ext) || COMPANION_EXT.has(ext) || ARCHIVE_EXT.has(ext) || ext === '.rar' || (system.folderGames && ext === '.iso');
  });
  const stem = (n) => n.slice(0, n.length - path.extname(n).length);
  const leaders = relevant.filter((f) => /\.(m3u|cue|ccd)$/i.test(f.Name))
    .sort((a, b) => (/\.m3u$/i.test(a.Name) ? 0 : 1) - (/\.m3u$/i.test(b.Name) ? 0 : 1));
  const taken = new Set();
  for (const lead of leaders) {
    if (taken.has(lead.Path)) continue;
    const s = stem(lead.Name).toLowerCase();
    const members = relevant.filter((f) => !taken.has(f.Path) && (f === lead || f.Name.toLowerCase().startsWith(s)));
    members.forEach((m) => taken.add(m.Path));
    units.set(`file:${lead.Path}`, {
      key: `file:${lead.Path}`, name: lead.Name, kind: 'files', files: members.map((m) => m.Path),
      size: members.reduce((t, m) => t + Math.max(0, m.Size || 0), 0)
    });
  }
  for (const f of relevant) {
    if (taken.has(f.Path)) continue;
    units.set(`file:${f.Path}`, { key: `file:${f.Path}`, name: f.Name, kind: 'files', files: [f.Path], size: Math.max(0, f.Size || 0) });
  }
  return [...units.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }));
}

function destFor(dataRoot, systemId) {
  return systemId === 'bios' ? path.join(dataRoot, 'bios') : path.join(dataRoot, 'roms', systemId);
}

// Ya descargado: el archivo existe con el mismo tamano, o la carpeta del juego existe.
// Si el archivo era un .zip/.7z que se descomprimio, queda una marca para no volver a bajarlo.
function isDownloaded(dataRoot, systemId, unit) {
  const dest = destFor(dataRoot, systemId);
  if (unit.kind === 'dir') return fs.existsSync(path.join(dest, unit.name));
  return unit.files.every((rel) => {
    const local = path.join(dest, path.basename(rel));
    try {
      if (fs.statSync(local).isFile()) return true;
    } catch { /* no existe */ }
    return fs.existsSync(path.join(dest, '.descargados', `${path.basename(rel)}.ok`));
  });
}

// Nombre "crudo" del juego (sin extension), como lo usa la biblioteca para titulo y portada.
function unitRawName(unit, system) {
  if (unit.kind === 'dir') return unit.name;
  const n = unit.name;
  const lower = n.toLowerCase();
  const ext = (system && system.ext ? system.ext : []).concat(['.zip', '.7z', '.rar', '.m3u', '.cue', '.ccd', '.iso'])
    .sort((a, b) => b.length - a.length).find((x) => lower.endsWith(x));
  return ext ? n.slice(0, n.length - ext.length) : n.replace(/\.[^.]+$/, '');
}

// Los updates y DLC de Switch que aun no estan en la carpeta de la consola.
function missingExtras(dataRoot, unit) {
  const dest = destFor(dataRoot, 'switch');
  // Un .7z/.rar que ya se bajo y se descomprimio deja su marca en .descargados (el comprimido se borra).
  return (unit.extras || []).flatMap((x) => x.files).filter((rel) => !fs.existsSync(path.join(dest, path.basename(rel)))
    && !fs.existsSync(path.join(dest, '.descargados', `${path.basename(rel)}.ok`)));
}

// ---------------------------------------------------------------- servicio

class CloudService extends EventEmitter {
  constructor({ getDataRoot, getCatalog, getRcloneExe, extract }) {
    super();
    this.getDataRoot = getDataRoot;
    this.getCatalog = getCatalog;
    this.getRcloneExe = getRcloneExe;
    this.extract = extract;
    this.queue = [];
    this.current = null;
    this.child = null;
    this.authChild = null;
    this.cache = new Map();
    this.seq = 0;
  }

  config() {
    return loadCloud(this.getDataRoot());
  }

  save(cfg) {
    this.cache.clear();
    return saveCloud(this.getDataRoot(), cfg);
  }

  rclone() {
    const exe = this.getRcloneExe();
    if (!exe) {
      const e = new Error('Falta instalar rclone (la herramienta que conecta con Google Drive).');
      e.code = 'NO_RCLONE';
      throw e;
    }
    return new Rclone({ exe, configPath: path.join(this.getDataRoot(), 'config', 'rclone.conf') });
  }

  resolveSource(sourceId) {
    const cfg = this.config();
    const src = cfg.carpetas.find((c) => (c.id || slug(c.nombre)) === sourceId) || (!sourceId && cfg.carpetas[0]);
    if (!src) throw new Error('Esa carpeta de la nube ya no existe en nube.json');
    const folderId = parseFolderId(src.enlace);
    if (!folderId) throw new Error(`El enlace de "${src.nombre}" no es una carpeta de Google Drive valida`);
    const account = src.cuenta || (cfg.cuentas[0] && cfg.cuentas[0].remoto);
    if (!account) {
      const e = new Error('Conecta una cuenta de Google en Menu > Nube');
      e.code = 'NO_ACCOUNT';
      throw e;
    }
    if (!cfg.cuentas.some((c) => c.remoto === account)) throw new Error(`La cuenta "${account}" de "${src.nombre}" no esta conectada`);
    return { src: { ...src, id: src.id || slug(src.nombre) }, folderId, account, cfg };
  }

  async status() {
    const cfg = this.config();
    let rcloneInstalled = false;
    let remotes = [];
    try {
      const r = this.rclone();
      rcloneInstalled = true;
      remotes = (await r.listRemotes()).filter((x) => x.type === 'drive').map((x) => x.name);
    } catch { /* sin rclone */ }
    return {
      rcloneInstalled,
      cuentas: cfg.cuentas.map((c) => ({ ...c, activa: remotes.includes(c.remoto) })),
      carpetas: cfg.carpetas.map((c) => ({ ...c, id: c.id || slug(c.nombre), valida: !!parseFolderId(c.enlace) })),
      mapeo: cfg.mapeo,
      descomprimir: cfg.descomprimir,
      archivo: cloudPath(this.getDataRoot())
    };
  }

  async connectAccount({ onLink } = {}) {
    const cfg = this.config();
    const r = this.rclone();
    const existing = new Set((await r.listRemotes()).map((x) => x.name));
    let n = 1;
    while (existing.has(`google${n}`) || cfg.cuentas.some((c) => c.remoto === `google${n}`)) n++;
    const name = `google${n}`;
    await r.createRemote(name, { onLink, track: (p) => { this.authChild = p; } });
    this.authChild = null;
    const email = await r.userEmail(name);
    cfg.cuentas.push({ remoto: name, nombre: email || `Cuenta de Google ${n}` });
    return this.save(cfg);
  }

  cancelConnect() {
    if (this.authChild) {
      try { this.authChild.kill(); } catch { /* nada */ }
      this.authChild = null;
      return true;
    }
    return false;
  }

  async removeAccount(remote) {
    const cfg = this.config();
    try { await this.rclone().deleteRemote(remote); } catch { /* ya no estaba */ }
    cfg.cuentas = cfg.cuentas.filter((c) => c.remoto !== remote);
    cfg.carpetas = cfg.carpetas.map((c) => (c.cuenta === remote ? { ...c, cuenta: '' } : c));
    return this.save(cfg);
  }

  saveSource({ id, nombre, enlace, cuenta }) {
    if (!parseFolderId(enlace)) throw new Error('Pega el enlace de una carpeta de Google Drive (drive.google.com/drive/folders/...)');
    const cfg = this.config();
    const label = (nombre || '').trim() || 'Carpeta de Google Drive';
    const newId = id || `${slug(label)}-${Date.now().toString(36).slice(-4)}`;
    const entry = { id: newId, nombre: label, enlace: enlace.trim(), cuenta: cuenta || '' };
    const i = cfg.carpetas.findIndex((c) => (c.id || slug(c.nombre)) === id);
    if (i >= 0) cfg.carpetas[i] = entry;
    else cfg.carpetas.push(entry);
    return this.save(cfg);
  }

  removeSource(id) {
    const cfg = this.config();
    cfg.carpetas = cfg.carpetas.filter((c) => (c.id || slug(c.nombre)) !== id);
    return this.save(cfg);
  }

  setMapping(folderName, systemId) {
    const cfg = this.config();
    cfg.mapeo = { ...cfg.mapeo, [folderName]: systemId };
    return this.save(cfg);
  }

  // Subcarpetas de la carpeta principal, con la consola a la que van.
  async folders(sourceId) {
    const { src, folderId, account, cfg } = this.resolveSource(sourceId);
    const catalog = this.getCatalog();
    const list = await this.rclone().lsjson(account, folderId, '', { dirsOnly: true });
    const folders = list.filter((x) => x.IsDir).map((x) => {
      const system = mapFolderToSystem(x.Name, cfg, catalog);
      return { name: x.Name, path: x.Path, system, supported: system === 'bios' || !!catalog.byId[system] };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    return { source: src, folders };
  }

  // Juegos de una subcarpeta, marcando cuales ya estan descargados.
  async items(sourceId, folderPath, systemId, { refresh = false } = {}) {
    const { src, folderId, account } = this.resolveSource(sourceId);
    const catalog = this.getCatalog();
    const system = systemId === 'bios' ? null : catalog.byId[systemId];
    if (systemId !== 'bios' && !system) throw new Error('Esta carpeta no esta asignada a ninguna consola');
    const cacheKey = `${src.id}|${folderPath}`;
    let files = !refresh && this.cache.get(cacheKey);
    if (!files) {
      files = await this.rclone().lsjson(account, folderId, folderPath, { recursive: true, filesOnly: true });
      this.cache.set(cacheKey, files);
    }
    const dataRoot = this.getDataRoot();
    let grouped = groupUnits(files, system);
    // Switch: los updates y DLC se bajan junto con su juego (no salen como juegos aparte).
    if (systemId === 'switch') grouped = attachSwitchExtras(grouped);
    const units = grouped.map((u) => {
      const id = `${src.id}|${folderPath}|${u.key}`;
      const extra = u.extras ? missingExtras(dataRoot, u) : [];
      return {
        ...u,
        id,
        files: [...u.files, ...extra],
        size: u.size + (u.extras || []).reduce((t, x) => t + x.size, 0),
        downloaded: isDownloaded(dataRoot, systemId, u) && !extra.length,
        queued: this.isQueued(id)
      };
    });
    return { source: src, folder: folderPath, system: systemId, items: units };
  }

  isQueued(id) {
    return this.queue.some((j) => j.id === id) || !!(this.current && this.current.id === id);
  }

  // ------------------------------------------------ indice completo (para ver tus juegos de Drive en la biblioteca)

  loadIndex() {
    if (this.indexData === undefined) this.indexData = readJsonSafe(indexPath(this.getDataRoot()), null);
    return this.indexData;
  }

  // Cuentas conectadas de verdad (sin abrir rclone): la cuenta esta en nube.json y en rclone.conf.
  connected() {
    const cfg = this.config();
    let conf = '';
    try { conf = fs.readFileSync(path.join(this.getDataRoot(), 'config', 'rclone.conf'), 'utf8'); } catch { /* sin cuentas */ }
    return cfg.cuentas.some((c) => conf.includes(`[${c.remoto}]`));
  }

  // Una sola lectura recursiva por carpeta de Drive.
  async buildIndex() {
    const cfg = this.config();
    const r = this.rclone();
    const out = { at: new Date().toISOString(), sources: {} };
    const errors = [];
    for (const c of cfg.carpetas) {
      let res;
      try { res = this.resolveSource(c.id || slug(c.nombre)); } catch (e) { errors.push(e.message); continue; }
      try {
        const files = await r.lsjson(res.account, res.folderId, '', { recursive: true, filesOnly: true });
        out.sources[res.src.id] = { nombre: res.src.nombre, files: files.filter((f) => !f.IsDir).map((f) => ({ Path: f.Path, Name: f.Name, Size: f.Size })) };
      } catch (e) {
        errors.push(`${res.src.nombre}: ${e.message}`);
        // Si falla (sin internet), se conserva lo que ya se sabia de esa carpeta.
        const prev = this.loadIndex();
        if (prev && prev.sources && prev.sources[res.src.id]) out.sources[res.src.id] = prev.sources[res.src.id];
      }
    }
    if (!Object.keys(out.sources).length && errors.length) throw new Error(errors[0]);
    writeJsonAtomic(indexPath(this.getDataRoot()), out);
    this.indexData = out;
    this.cache.clear();
    return { index: out, errors };
  }

  // Todo lo que hay en la nube, por carpeta y consola: [{ id, sourceId, folder, system, unit }]
  cloudUnits() {
    const index = this.loadIndex();
    if (!index || !index.sources) return [];
    const cfg = this.config();
    const catalog = this.getCatalog();
    const out = [];
    for (const [sourceId, src] of Object.entries(index.sources)) {
      if (!cfg.carpetas.some((c) => (c.id || slug(c.nombre)) === sourceId)) continue;
      const byFolder = new Map();
      for (const f of src.files || []) {
        const i = f.Path.indexOf('/');
        if (i < 0) continue;
        const folder = f.Path.slice(0, i);
        const list = byFolder.get(folder) || [];
        list.push({ Path: f.Path.slice(i + 1), Name: f.Name, Size: f.Size, IsDir: false });
        byFolder.set(folder, list);
      }
      for (const [folder, files] of byFolder) {
        const systemId = mapFolderToSystem(folder, cfg, catalog);
        if (!systemId || (systemId !== 'bios' && !catalog.byId[systemId])) continue;
        // La vista de la nube tambien abre al instante con esta lista.
        this.cache.set(`${sourceId}|${folder}`, files);
        let units = groupUnits(files, systemId === 'bios' ? null : catalog.byId[systemId]);
        if (systemId === 'switch') units = attachSwitchExtras(units);
        for (const u of units) out.push({ id: `${sourceId}|${folder}|${u.key}`, sourceId, folder, system: systemId, unit: u });
      }
    }
    return out;
  }

  // Juegos de la nube que aun no tienes, listos para mostrarse en la biblioteca: { [consola]: [juego] }
  cloudGames() {
    const dataRoot = this.getDataRoot();
    const catalog = this.getCatalog();
    const out = {};
    for (const c of this.cloudUnits()) {
      if (c.system === 'bios' || isDownloaded(dataRoot, c.system, c.unit)) continue;
      const sys = catalog.byId[c.system];
      const rawName = unitRawName(c.unit, sys);
      const title = titleFor(c.system, rawName);
      (out[c.system] = out[c.system] || []).push({
        id: c.id,
        cloud: true,
        system: c.system,
        title,
        rawName,
        size: c.unit.size + (c.unit.extras || []).reduce((t, x) => t + x.size, 0),
        cover: findCover(dataRoot, c.system, [rawName, withoutCopyPrefix(rawName), title]),
        sourceId: c.sourceId,
        folder: c.folder,
        folderGame: c.unit.kind === 'dir',
        extras: (c.unit.extras || []).length
      });
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base', numeric: true }));
    return out;
  }

  jobFor(c, extra = {}) {
    const sys = this.getCatalog().byId[c.system];
    const files = [...c.unit.files, ...(c.unit.extras ? missingExtras(this.getDataRoot(), c.unit) : [])];
    const name = c.system === 'bios' ? c.unit.name : titleFor(c.system, unitRawName(c.unit, sys));
    return { id: c.id, sourceId: c.sourceId, folder: c.folder, system: c.system, name, kind: c.unit.kind, path: c.unit.path, files, size: c.unit.size, ...extra };
  }

  // Descargar un juego de la nube para jugarlo ya: va primero en la fila.
  playJob(id) {
    const c = this.cloudUnits().find((x) => x.id === id);
    if (!c) throw new Error('Ese juego ya no está en tu Google Drive. Actualiza la lista en Menú > Nube.');
    const job = this.jobFor(c, { play: true });
    this.enqueue([job], { front: true });
    return { id: job.id, name: job.name, system: c.system, size: job.size, unit: c.unit };
  }

  // Lo que falta bajar sin que lo pidas: BIOS de la carpeta BIOS y updates/DLC nuevos de juegos de Switch que ya tienes.
  backgroundJobs() {
    const dataRoot = this.getDataRoot();
    const jobs = [];
    for (const c of this.cloudUnits()) {
      if (c.system === 'bios') {
        if (!isDownloaded(dataRoot, 'bios', c.unit) && !this.isQueued(c.id)) jobs.push(this.jobFor(c, { quiet: true }));
      } else if (c.system === 'switch' && c.unit.extras && c.unit.extras.length && isDownloaded(dataRoot, 'switch', c.unit)) {
        const files = missingExtras(dataRoot, c.unit);
        const id = `${c.id}|extras`;
        if (files.length && !this.isQueued(id)) {
          const base = this.jobFor(c);
          jobs.push({ ...base, id, name: `${base.name} (updates y DLC)`, kind: 'files', files, size: c.unit.extras.reduce((t, x) => t + x.size, 0), quiet: true });
        }
      }
    }
    return jobs;
  }

  enqueue(jobs, { front = false } = {}) {
    const added = [];
    for (const j of jobs) {
      if (this.current && this.current.id === j.id) {
        if (j.play) this.current.play = true;
        continue;
      }
      const i = this.queue.findIndex((q) => q.id === j.id);
      if (i >= 0) {
        // Ya estaba en la fila: si lo quieres jugar, pasa al frente.
        if (front) {
          const [old] = this.queue.splice(i, 1);
          this.queue.unshift({ ...old, play: old.play || !!j.play });
        }
        continue;
      }
      const job = { ...j, seq: ++this.seq, state: 'pendiente', bytes: 0, total: j.size || 0 };
      if (front) this.queue.unshift(job);
      else this.queue.push(job);
      added.push(job);
    }
    this.emitQueue();
    this.pump();
    return added.length;
  }

  emitQueue() {
    this.emit('queue', this.snapshot());
  }

  snapshot() {
    const view = (j) => j && { id: j.id, name: j.name, system: j.system, state: j.state, bytes: j.bytes, total: j.total, speed: j.speed || 0, eta: j.eta ?? null, play: !!j.play, quiet: !!j.quiet };
    return { current: view(this.current), pending: this.queue.map(view) };
  }

  cancel(id) {
    if (!id || (this.current && this.current.id === id)) {
      if (this.current) this.current.cancelled = true;
      if (this.child) { try { this.child.kill(); } catch { /* nada */ } }
    }
    if (id) this.queue = this.queue.filter((j) => j.id !== id);
    else this.queue = [];
    this.emitQueue();
    return true;
  }

  async pump() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    job.state = 'descargando';
    this.emitQueue();
    let ok = false;
    let error = null;
    try {
      await this.runJob(job);
      ok = !job.cancelled;
      if (job.cancelled) error = 'Cancelado';
    } catch (e) {
      error = e.message;
    }
    this.child = null;
    this.current = null;
    this.emit('done', { id: job.id, name: job.name, system: job.system, ok, error, play: !!job.play, quiet: !!job.quiet, files: job.files, kind: job.kind, path: job.path || null });
    this.emitQueue();
    this.pump();
  }

  async runJob(job) {
    const { folderId, account, cfg } = this.resolveSource(job.sourceId);
    const r = this.rclone();
    const dataRoot = this.getDataRoot();
    const dest = destFor(dataRoot, job.system);
    fs.mkdirSync(dest, { recursive: true });
    const catalog = this.getCatalog();
    const system = job.system === 'bios' ? null : catalog.byId[job.system];
    const track = (p) => { this.child = p; };
    const progress = (base) => (p) => {
      job.bytes = base + p.bytes;
      job.total = Math.max(job.total, base + (p.total || 0));
      job.speed = p.speed;
      job.eta = p.eta;
      this.emit('progress', { id: job.id, bytes: job.bytes, total: job.total, speed: job.speed, eta: job.eta });
    };

    if (job.kind === 'dir') {
      const res = await r.copy(account, folderId, `${job.folder}/${job.path}`, path.join(dest, job.path || job.name), { onProgress: progress(0), track });
      if (res.code !== 0 && !job.cancelled) throw new Error(Rclone.errorText(res));
      return;
    }

    let base = 0;
    for (const rel of job.files) {
      if (job.cancelled) return;
      const res = await r.copy(account, folderId, `${job.folder}/${rel}`, dest, { onProgress: progress(base), track });
      if (res.code !== 0 && !job.cancelled) throw new Error(Rclone.errorText(res));
      base = job.bytes;
      const local = path.join(dest, path.basename(rel));
      const ext = path.extname(local).toLowerCase();
      // .zip/.7z en una consola que no los lee (por ejemplo PS2): se descomprimen y se borra el comprimido.
      if (cfg.descomprimir && system && ARCHIVE_EXT.has(ext) && !system.ext.includes(ext) && this.extract) {
        job.state = 'descomprimiendo';
        this.emitQueue();
        await this.extract(local, dest);
        fs.mkdirSync(path.join(dest, '.descargados'), { recursive: true });
        fs.writeFileSync(path.join(dest, '.descargados', `${path.basename(local)}.ok`), new Date().toISOString());
        fs.rmSync(local, { force: true });
        job.state = 'descargando';
      }
      // Arcade: el romset debe llamarse exacto (kof2002.zip); "Copia de kof2002.zip" no abre en MAME/FBNeo.
      if (['mame', 'neogeo'].includes(job.system) && withoutCopyPrefix(path.basename(local)) !== path.basename(local)) {
        const fixed = path.join(dest, withoutCopyPrefix(path.basename(local)));
        if (!fs.existsSync(fixed)) fs.renameSync(local, fixed);
        else fs.rmSync(local, { force: true });
        fs.mkdirSync(path.join(dest, '.descargados'), { recursive: true });
        fs.writeFileSync(path.join(dest, '.descargados', `${path.basename(local)}.ok`), new Date().toISOString());
        continue;
      }
      // El BIOS de Neo Geo se deja donde lo buscan los emuladores: bios\fbneo (FBNeo) y junto a los juegos
      // de Neo Geo y de MAME (los juegos de Neo Geo en la carpeta Arcade/MAME tambien lo necesitan).
      if (path.basename(local).toLowerCase() === 'neogeo.zip' && ['bios', 'neogeo', 'mame'].includes(job.system)) {
        for (const dir of [path.join(dataRoot, 'bios', 'fbneo'), path.join(dataRoot, 'roms', 'neogeo'), path.join(dataRoot, 'roms', 'mame')]) {
          if (path.resolve(dir) === path.resolve(path.dirname(local))) continue;
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(local, path.join(dir, 'neogeo.zip'));
        }
      }
    }
  }
}

module.exports = {
  CloudService, Rclone, loadCloud, saveCloud, parseFolderId, mapFolderToSystem, groupUnits, isDownloaded, destFor, cloudPath, slug, indexPath, unitRawName, missingExtras
};
