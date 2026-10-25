'use strict';
// Piloto automatico: todo lo que antes era un paso a mano, CanacaLabArcadia lo hace sola en segundo plano.
//  1. Nube: actualiza la lista de juegos de tus carpetas de Drive y baja la carpeta BIOS (y updates/DLC de Switch).
//  2. Emuladores: instala los que necesitan las consolas donde tienes juegos (en la Ally o en tu Drive).
//  3. Xbox: disco duro en blanco del proyecto xemu.  PS3: firmware oficial de Sony (se instala al abrir el primer juego).
//  4. Portadas.
// Mientras juegas no empieza nada nuevo (para no quitarle rendimiento al juego).
const path = require('path');
const { EventEmitter } = require('events');
const { readJsonSafe, writeJsonAtomic } = require('./store');

class Autopilot extends EventEmitter {
  constructor(deps) {
    super();
    this.d = deps;
    this.running = false;
    this.again = null;
    this.state = { busy: false, label: null, pct: null };
    this.lastErrors = [];
  }

  set(label, pct = null) {
    this.state = { busy: !!label, label: label || null, pct };
    this.emit('status', this.state);
  }

  async whilePlaying() {
    const { isPlaying, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = this.d;
    let paused = false;
    while (isPlaying && isPlaying()) {
      if (!paused) { paused = true; this.set(null); }
      await sleep(4000);
    }
  }

  // Consolas con juegos (en la biblioteca o en la nube).
  wantedSystems() {
    const lib = this.d.getLibrary() || {};
    const cloud = this.d.cloud && this.d.cloud.cloudGames ? safe(() => this.d.cloud.cloudGames(), {}) : {};
    return this.d.getCatalog().systems.filter((s) => (lib[s.id] || []).length || (cloud[s.id] || []).length).map((s) => s.id);
  }

  // { emu, core } a instalar para que la consola quede lista, o null.
  missingFor(systemId) {
    const { resolve, getCatalog } = this.d;
    const r = resolve(systemId);
    if (!r || r.ready) return null;
    const catalog = getCatalog();
    for (const m of r.missing || []) {
      const def = catalog.emulators[m.emu];
      if (!def || !def.install || def.install.type === 'manual') continue;
      return m.what === 'nucleo' ? { emu: m.emu, core: m.core } : { emu: m.emu };
    }
    return null;
  }

  async run(reason = 'inicio') {
    if (this.running) { this.again = reason; return; }
    this.running = true;
    this.lastErrors = [];
    try {
      await this.steps(reason);
    } finally {
      this.running = false;
      this.set(null);
      this.emit('idle', { errors: this.lastErrors });
      if (this.again) {
        const r = this.again;
        this.again = null;
        setTimeout(() => this.run(r), 50);
      }
    }
  }

  async step(label, fn) {
    await this.whilePlaying();
    try {
      await fn();
    } catch (e) {
      this.lastErrors.push(`${label}: ${e.message}`);
      if (this.d.log) this.d.log(`[piloto] ${label}: ${e.message}`);
    }
  }

  async steps(reason) {
    const d = this.d;
    const cloud = d.cloud;

    // 1. Nube
    if (cloud && cloud.connected()) {
      await this.step('nube', async () => {
        if (!d.hasRclone()) {
          this.set('Preparando Google Drive');
          await d.install('rclone');
        }
        if (reason !== 'juego') {
          this.set('Revisando tu Google Drive');
          await cloud.buildIndex();
          this.emit('index');
        }
        const jobs = cloud.backgroundJobs();
        if (jobs.length) cloud.enqueue(jobs);
      });
    }

    // 2. Emuladores y nucleos
    const wanted = this.wantedSystems();
    const done = new Set();
    for (const sysId of wanted) {
      const need = this.missingFor(sysId);
      if (!need) continue;
      const key = need.core ? `${need.emu}:${need.core}` : need.emu;
      if (done.has(key)) continue;
      done.add(key);
      const name = d.getCatalog().emulators[need.emu].name;
      await this.step(name, async () => {
        this.set(need.core ? `Instalando núcleo ${need.core}` : `Instalando ${name}`);
        if (need.core) await d.installCore(need.core, (p) => this.set(`Instalando núcleo ${need.core}`, p.pct));
        else await d.install(need.emu, (p) => this.set(`Instalando ${name}`, p.pct));
        this.emit('installed', key);
      });
    }

    // 3. Archivos gratuitos de Xbox y PS3
    if (wanted.includes('xbox') && d.needsXboxHdd && d.needsXboxHdd()) {
      await this.step('Xbox', async () => {
        this.set('Preparando el disco duro de Xbox');
        await d.downloadXboxHdd();
        this.emit('installed', 'xbox-hdd');
      });
    }
    if (wanted.includes('ps3') && d.needsPs3Pup && d.needsPs3Pup()) {
      await this.step('PS3', async () => {
        this.set('Bajando el firmware de PS3 de Sony', 0);
        await d.downloadPs3Pup((p) => this.set('Bajando el firmware de PS3 de Sony', p.pct));
        this.emit('installed', 'ps3-pup');
      });
    }

    // 4. Portadas (las que no existan en libretro no se vuelven a pedir)
    if (d.fetchCovers && reason !== 'juego') {
      await this.step('portadas', async () => {
        const items = this.coverTargets();
        if (!items.length) return;
        this.set('Buscando portadas', 0);
        const res = await d.fetchCovers(items, (p) => this.set('Buscando portadas', p.total ? Math.round((p.done / p.total) * 100) : null));
        this.rememberMisses(res && res.misses);
        if (res && res.found) this.emit('covers', res.found);
      });
    }
  }

  missesFile() {
    return path.join(this.d.getDataRoot(), 'config', 'portadas-sin.json');
  }

  // Las fuentes de portadas activas: si cambian (por ejemplo, agregas IGDB), se vuelve a intentar con todo.
  coverSignature() {
    return this.d.coverSources ? this.d.coverSources().join('+') : 'libretro';
  }

  readMisses() {
    const raw = readJsonSafe(this.missesFile(), null);
    const data = Array.isArray(raw) ? { firma: 'libretro', lista: raw } : (raw || { firma: null, lista: [] });
    return data.firma === this.coverSignature() ? new Set(data.lista || []) : new Set();
  }

  coverTargets({ ignoreMisses = false } = {}) {
    const catalog = this.d.getCatalog();
    const lib = this.d.getLibrary() || {};
    const cloud = this.d.cloud ? safe(() => this.d.cloud.cloudGames(), {}) : {};
    const misses = ignoreMisses ? new Set() : this.readMisses();
    // Con IGDB o ScreenScraper tambien hay portadas para consolas y juegos en carpeta que libretro no tiene.
    const smart = this.coverSignature() !== 'libretro';
    const out = [];
    const seen = new Set();
    for (const sys of catalog.systems) {
      if (!sys.thumbs && !smart) continue;
      for (const g of [...(lib[sys.id] || []), ...(cloud[sys.id] || [])]) {
        if (g.cover) continue;
        if (g.folderGame && !smart) continue;
        const key = `${sys.id}/${String(g.rawName).replace(/^\s*(copia de|copy of)\s+/i, '')}`;
        if (misses.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({ sys, g });
      }
    }
    return out;
  }

  rememberMisses(list) {
    if (!list || !list.length) return;
    const file = this.missesFile();
    const all = this.readMisses();
    for (const k of list) all.add(k);
    try { writeJsonAtomic(file, { firma: this.coverSignature(), lista: [...all] }); } catch { /* no importa */ }
  }
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

module.exports = { Autopilot };
