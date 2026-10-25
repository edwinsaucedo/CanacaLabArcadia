'use strict';
// Portadas inteligentes: busca la portada de cada juego en varias fuentes, de la mas exacta a la mas general.
//  1. ScreenScraper (si configuras tu cuenta y tus identificadores de desarrollador): reconoce el archivo por su
//     huella (MD5), su nombre, su tamano y la consola, aunque el archivo tenga un nombre raro.
//  2. IGDB (de Twitch, con tu Client ID y Client Secret): busca por el titulo limpio dentro de la consola y elige
//     el resultado mas parecido (sirve muy bien para PS3, PS4, Switch y Xbox 360).
//  3. libretro-thumbnails (sin cuenta): solo si el archivo tiene el nombre exacto No-Intro / Redump.
// Las llaves viven en <biblioteca>\config\portadas.json (en tu Ally, no en el instalador que compartes).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJsonSafe, writeJsonAtomic } = require('./store');
const { thumbUrl } = require('./covers');

const UA = 'CanacaLabArcadia/1.7';

// Consolas de CanacaLabArcadia -> plataformas de IGDB y sistemas de ScreenScraper.
const IGDB_PLATFORMS = {
  nes: [18], snes: [19], n64: [4], gb: [33, 22], gba: [24], nds: [20], gamecube: [21], wii: [5], switch: [130],
  genesis: [29], ps1: [7], ps2: [8], ps3: [9], ps4: [48], psp: [38], xbox: [11], xbox360: [12],
  mame: [52, 79, 80], neogeo: [79, 80, 52]
};
const SS_SYSTEMS = {
  nes: 3, snes: 4, n64: 14, gb: 9, gba: 12, nds: 15, gamecube: 13, wii: 16, switch: 225, genesis: 1,
  ps1: 57, ps2: 58, ps3: 59, ps4: 60, psp: 61, xbox: 32, xbox360: 33, mame: 75, neogeo: 142
};

// ---------------------------------------------------------------- configuracion

function configPath(dataRoot) {
  return path.join(dataRoot, 'config', 'portadas.json');
}

function loadScraperConfig(dataRoot) {
  const raw = readJsonSafe(configPath(dataRoot), {});
  const s = raw.screenscraper || {};
  const i = raw.igdb || {};
  return {
    screenscraper: { usuario: s.usuario || '', clave: s.clave || '', devid: s.devid || '', devclave: s.devclave || '' },
    igdb: { clientId: i.clientId || '', clientSecret: i.clientSecret || '' }
  };
}

// Guarda solo lo que cambiaste; un campo vacio no borra lo guardado salvo que lo pidas con null.
function saveScraperConfig(dataRoot, patch = {}) {
  const cur = loadScraperConfig(dataRoot);
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (v === null) out[k] = '';
      else if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  };
  const next = { screenscraper: merge(cur.screenscraper, patch.screenscraper), igdb: merge(cur.igdb, patch.igdb) };
  writeJsonAtomic(configPath(dataRoot), next);
  return next;
}

// Lo que ve la interfaz: si cada campo tiene algo, sin mostrar las claves.
function publicScraperConfig(cfg) {
  return {
    screenscraper: { usuario: cfg.screenscraper.usuario, clave: !!cfg.screenscraper.clave, devid: cfg.screenscraper.devid, devclave: !!cfg.screenscraper.devclave },
    igdb: { clientId: cfg.igdb.clientId, clientSecret: !!cfg.igdb.clientSecret },
    activas: sourcesOf(cfg)
  };
}

function sourcesOf(cfg) {
  const out = [];
  if (cfg.screenscraper.devid && cfg.screenscraper.devclave) out.push('screenscraper');
  if (cfg.igdb.clientId && cfg.igdb.clientSecret) out.push('igdb');
  out.push('libretro');
  return out;
}

// ---------------------------------------------------------------- busqueda inteligente por titulo

function normalizeTitle(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\s*(copia de|copy of)\s+/, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an|el|la|los|las)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (m) => String(['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'].indexOf(m) + 2))
    .replace(/\s+/g, ' ')
    .trim();
}

// 1 = mismo titulo. Compara palabras (Dice) y premia que una contenga a la otra desde el inicio.
function similarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = x.split(' ');
  const ty = y.split(' ');
  const setY = new Set(ty);
  const common = tx.filter((w) => setY.has(w)).length;
  let score = (2 * common) / (tx.length + ty.length);
  if (y.startsWith(`${x} `) || x.startsWith(`${y} `)) score = Math.max(score, 0.8);
  // Numeros distintos (Mario Kart 7 vs Mario Kart 8) no son el mismo juego.
  const nx = tx.filter((w) => /^\d+$/.test(w)).join(' ');
  const ny = ty.filter((w) => /^\d+$/.test(w)).join(' ');
  if (nx !== ny) score *= 0.6;
  return score;
}

// Titulo para buscar: sin "Copia de", sin [tags] (region, title ID, version) y sin el codigo del disco.
function searchTitle(g) {
  return String(g.title || g.rawName || '')
    .replace(/^\s*(copia de|copy of)\s+/i, '')
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/^[A-Z]{4}[-_]?\d{5}\s*[-_–:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- IGDB

class Igdb {
  constructor({ clientId, clientSecret, fetchImpl = fetch, minGapMs = 260 }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.minGapMs = minGapMs;
    this.tokenValue = null;
    this.tokenUntil = 0;
    this.last = 0;
  }

  async token(force = false) {
    if (!force && this.tokenValue && Date.now() < this.tokenUntil) return this.tokenValue;
    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&grant_type=client_credentials`;
    const r = await this.fetch(url, { method: 'POST', headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Twitch no aceptó tu Client ID o tu Client Secret.' : `Twitch respondió ${r.status}.`);
    const j = await r.json();
    this.tokenValue = j.access_token;
    this.tokenUntil = Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000;
    return this.tokenValue;
  }

  // IGDB permite 4 consultas por segundo: se espacian solas.
  async query(endpoint, body, retry = true) {
    const wait = this.last + this.minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const token = await this.token();
    const r = await this.fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA },
      body
    });
    if (r.status === 401 && retry) {
      await this.token(true);
      return this.query(endpoint, body, false);
    }
    if (r.status === 429 && retry) {
      await new Promise((res) => setTimeout(res, 1100));
      return this.query(endpoint, body, false);
    }
    if (!r.ok) throw new Error(`IGDB respondió ${r.status}.`);
    return r.json();
  }

  // { url, name, score } del juego mas parecido en esa consola, o null.
  async findCover(g) {
    const platforms = IGDB_PLATFORMS[g.system];
    if (!platforms) return null;
    const title = searchTitle(g);
    if (!title) return null;
    const tries = [title];
    // Si no aparece con subtitulo, se intenta con el nombre principal ("Zelda - Breath of the Wild" -> "Zelda").
    const main = title.split(/\s+[-:–]\s+|:\s*/)[0].trim();
    if (main && main !== title && main.length >= 4) tries.push(main);
    for (const term of tries) {
      const safe = term.replace(/"/g, '');
      const body = `search "${safe}"; fields name,alternative_names.name,cover.image_id,platforms; where platforms = (${platforms.join(',')}) & cover != null; limit 20;`;
      const list = await this.query('games', body);
      let best = null;
      for (const game of list || []) {
        if (!game.cover || !game.cover.image_id) continue;
        const names = [game.name, ...((game.alternative_names || []).map((a) => a.name))];
        const score = Math.max(...names.map((n) => similarity(title, n)));
        if (!best || score > best.score) best = { score, name: game.name, imageId: game.cover.image_id };
      }
      if (best && best.score >= 0.6) {
        return { url: `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${best.imageId}.jpg`, name: best.name, score: best.score, source: 'igdb' };
      }
    }
    return null;
  }

  async test() {
    await this.token(true);
    const r = await this.query('platforms', 'fields name; where id = 130;');
    return Array.isArray(r);
  }
}

// ---------------------------------------------------------------- ScreenScraper

const SS_BASE = 'https://api.screenscraper.fr/api2';
const SS_REGIONS = ['us', 'wor', 'eu', 'mx', 'sp', 'ss', 'jp'];

class ScreenScraper {
  constructor({ devid, devclave, usuario, clave, fetchImpl = fetch }) {
    this.cfg = { devid, devclave, usuario, clave };
    this.fetch = fetchImpl;
    this.blocked = null;
  }

  url(script, params) {
    const q = new URLSearchParams({ devid: this.cfg.devid, devpassword: this.cfg.devclave, softname: 'CanacaLabArcadia', output: 'json' });
    if (this.cfg.usuario && this.cfg.clave) { q.set('ssid', this.cfg.usuario); q.set('sspassword', this.cfg.clave); }
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    return `${SS_BASE}/${script}?${q}`;
  }

  async get(script, params) {
    if (this.blocked) throw new Error(this.blocked);
    const r = await this.fetch(this.url(script, params), { headers: { 'User-Agent': UA } });
    const text = await r.text();
    if (r.status === 404) return null;
    // Cuotas y servidor ocupado: se deja de usar ScreenScraper en esta pasada.
    if ([401, 403, 423, 426, 429, 430, 431].includes(r.status)) {
      this.blocked = r.status === 403 ? 'ScreenScraper no aceptó tus datos de desarrollador o de usuario.' : `ScreenScraper no está disponible ahora (${r.status}): ${text.slice(0, 120)}`;
      throw new Error(this.blocked);
    }
    if (!r.ok) throw new Error(`ScreenScraper respondió ${r.status}.`);
    try { return JSON.parse(text); } catch { return null; }
  }

  async findCover(g, { md5 = null, size = null } = {}) {
    const systemeid = SS_SYSTEMS[g.system];
    if (!systemeid) return null;
    const romnom = g.fileName || `${g.rawName}`;
    const j = await this.get('jeuInfos.php', { systemeid, romtype: g.folderGame ? 'dossier' : 'rom', romnom, romtaille: size, md5 });
    const jeu = j && j.response && j.response.jeu;
    if (!jeu || !Array.isArray(jeu.medias)) return null;
    const pick = (type) => {
      const list = jeu.medias.filter((m) => m.type === type && m.url);
      for (const reg of SS_REGIONS) {
        const hit = list.find((m) => m.region === reg);
        if (hit) return hit;
      }
      return list[0] || null;
    };
    const media = pick('box-2D') || pick('box-3D') || pick('mixrbv2') || pick('ss');
    if (!media) return null;
    const name = (jeu.noms && (jeu.noms.find((n) => n.region === 'us' || n.region === 'wor') || jeu.noms[0]) || {}).text || null;
    return { url: media.url, name, score: 1, source: 'screenscraper' };
  }

  async test() {
    const j = await this.get('ssuserInfos.php', {});
    const u = j && j.response && j.response.ssuser;
    if (!u) throw new Error('ScreenScraper no devolvió tu usuario.');
    return { usuario: u.id, hoy: Number(u.requeststoday) || 0, maximo: Number(u.maxrequestsperday) || null };
  }
}

// MD5 del archivo (solo archivos medianos: una ISO de 4 GB tardaria demasiado; esas se buscan por nombre y tamano).
function md5Of(file, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve) => {
    let st;
    try { st = fs.statSync(file); } catch { return resolve(null); }
    if (!st.isFile() || st.size > maxBytes) return resolve(null);
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', () => resolve(null)).on('end', () => resolve(h.digest('hex')));
  });
}

// ---------------------------------------------------------------- descarga y orquestacion

function imageExt(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

async function saveImage(fetchImpl, url, destNoExt) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = imageExt(buf);
  if (!ext || buf.length < 200) return null;
  fs.mkdirSync(path.dirname(destNoExt), { recursive: true });
  const file = `${destNoExt}${ext}`;
  fs.writeFileSync(file, buf);
  return file;
}

function buildSources(cfg, fetchImpl) {
  const out = [];
  if (cfg.screenscraper.devid && cfg.screenscraper.devclave) out.push({ id: 'screenscraper', api: new ScreenScraper({ ...cfg.screenscraper, fetchImpl }) });
  if (cfg.igdb.clientId && cfg.igdb.clientSecret) out.push({ id: 'igdb', api: new Igdb({ ...cfg.igdb, fetchImpl }) });
  return out;
}

// items: [{ sys, g }]. Devuelve { found, missing, total, misses, bySource, errors }.
async function fetchSmartCovers(dataRoot, items, { onProgress, fetchImpl = fetch, config = loadScraperConfig(dataRoot), libretroBase = 'https://thumbnails.libretro.com' } = {}) {
  const sources = buildSources(config, fetchImpl);
  const result = { found: 0, missing: 0, total: items.length, misses: [], bySource: {}, errors: [] };
  const noteError = (msg) => { if (!result.errors.includes(msg)) result.errors.push(msg); };
  let done = 0;
  for (const { sys, g } of items) {
    const dest = path.join(dataRoot, 'media', 'covers', sys.id, g.rawName);
    let saved = null;
    const game = { ...g, system: sys.id };
    for (const src of sources) {
      try {
        let hit = null;
        if (src.id === 'screenscraper') {
          const file = g.cloud ? null : (g.launch && g.launch !== g.path ? null : g.path);
          let size = null;
          try { size = file ? fs.statSync(file).size : (g.size || null); } catch { size = g.size || null; }
          const md5 = file ? await md5Of(file) : null;
          hit = await src.api.findCover({ ...game, fileName: file ? path.basename(file) : null }, { md5, size });
        } else {
          hit = await src.api.findCover(game);
        }
        if (hit) saved = await saveImage(fetchImpl, hit.url, dest);
        if (saved) { result.bySource[src.id] = (result.bySource[src.id] || 0) + 1; break; }
      } catch (e) {
        noteError(e.message);
      }
    }
    if (!saved && sys.thumbs) {
      try {
        const lookup = String(g.rawName).replace(/^\s*(copia de|copy of)\s+/i, '');
        saved = await saveImage(fetchImpl, thumbUrl(sys.thumbs, lookup, 'Named_Boxarts', libretroBase), dest);
        if (saved) result.bySource.libretro = (result.bySource.libretro || 0) + 1;
      } catch { /* sin internet */ }
    }
    if (saved) result.found++;
    else {
      result.missing++;
      result.misses.push(`${sys.id}/${String(g.rawName).replace(/^\s*(copia de|copy of)\s+/i, '')}`);
    }
    done++;
    if (onProgress) onProgress({ done, total: items.length, title: g.title });
  }
  return result;
}

// Prueba las llaves que guardaste: { igdb: 'ok' | mensaje, screenscraper: 'ok ...' | mensaje }
async function testScraperConfig(cfg, fetchImpl = fetch) {
  const out = {};
  if (cfg.igdb.clientId && cfg.igdb.clientSecret) {
    try { await new Igdb({ ...cfg.igdb, fetchImpl }).test(); out.igdb = 'ok'; } catch (e) { out.igdb = e.message; }
  }
  if (cfg.screenscraper.devid && cfg.screenscraper.devclave) {
    try {
      const u = await new ScreenScraper({ ...cfg.screenscraper, fetchImpl }).test();
      out.screenscraper = u.maximo ? `ok: ${u.hoy} de ${u.maximo} consultas hoy` : 'ok';
    } catch (e) { out.screenscraper = e.message; }
  }
  return out;
}

module.exports = {
  IGDB_PLATFORMS, SS_SYSTEMS, configPath, loadScraperConfig, saveScraperConfig, publicScraperConfig, sourcesOf,
  normalizeTitle, similarity, searchTitle, Igdb, ScreenScraper, md5Of, imageExt, fetchSmartCovers, testScraperConfig
};
