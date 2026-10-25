// Simulador del proceso principal. Solo se activa al abrir la interfaz en un navegador comun
// (para disenar y probar sin Electron). Dentro de CanacaLabArcadia, window.arcadia ya existe y esto no hace nada.
(function () {
  if (window.arcadia) return;
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((fn) => fn(p));
  const ok = (data) => Promise.resolve({ ok: true, data });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const SAMPLE = {
    ps2: ['Okami (USA)', 'Shadow of the Colossus (USA)', 'Final Fantasy X (USA)', 'Kingdom Hearts II (USA)', 'God of War II (USA)',
      'Grand Theft Auto - San Andreas (USA)', 'Metal Gear Solid 3 - Snake Eater (USA)', 'Tekken 5 (USA)', 'Jak and Daxter - The Precursor Legacy (USA)',
      'Ratchet & Clank (USA)', 'Silent Hill 2 (USA)', 'Shin Megami Tensei - Persona 4 (USA)', 'Burnout 3 - Takedown (USA)', 'Ico (USA)'],
    gamecube: ['Super Smash Bros. Melee (USA)', 'The Legend of Zelda - The Wind Waker (USA)', 'Metroid Prime (USA)', 'F-Zero GX (USA)', 'Pikmin (USA)', 'Mario Kart - Double Dash!! (USA)'],
    wii: ['Super Mario Galaxy (USA)', 'Mario Kart Wii (USA)', 'Xenoblade Chronicles (USA)', 'Super Smash Bros. Brawl (USA)'],
    n64: ['Super Mario 64 (USA)', 'The Legend of Zelda - Ocarina of Time (USA)', 'GoldenEye 007 (USA)', 'Mario Kart 64 (USA)', 'Banjo-Kazooie (USA)'],
    nes: ['Super Mario Bros. 3 (USA)', 'Mega Man 2 (USA)', 'Castlevania (USA)', 'Contra (USA)'],
    snes: ['Super Metroid (Japan, USA)', 'Chrono Trigger (USA)', 'Super Mario World (USA)', 'Donkey Kong Country (USA)'],
    psp: ['Crisis Core - Final Fantasy VII (USA)', 'God of War - Chains of Olympus (USA)', 'Monster Hunter Freedom Unite (USA)'],
    ps1: ['Final Fantasy VII (USA)', 'Castlevania - Symphony of the Night (USA)', 'Crash Bandicoot (USA)'],
    ps3: ["Demon's Souls", 'The Last of Us', 'Uncharted 2: Among Thieves'],
    ps4: ['Bloodborne'],
    xbox360: ['Halo 3 (USA)', 'Gears of War (USA)', 'Forza Horizon (USA)'],
    xbox: ['Halo - Combat Evolved (USA)', 'Jet Set Radio Future (USA)'],
    switch: ['The Legend of Zelda - Breath of the Wild', 'Super Mario Odyssey'],
    neogeo: ['mslug', 'kof98', 'garou', 'samsho2', 'blazstar'],
    mame: ['sf2ce', 'mvsc', 'simpsons', 'tmnt', 'dino', 'pacman'],
    genesis: ['Sonic the Hedgehog 2 (World)', 'Streets of Rage 2 (USA)']
  };
  const NAMES = {
    mslug: 'Metal Slug', kof98: "The King of Fighters '98", garou: 'Garou: Mark of the Wolves', samsho2: 'Samurai Shodown II', blazstar: 'Blazing Star',
    sf2ce: "Street Fighter II': Champion Edition", mvsc: 'Marvel vs. Capcom', simpsons: 'The Simpsons', tmnt: 'Teenage Mutant Ninja Turtles', dino: 'Cadillacs and Dinosaurs', pacman: 'Pac-Man'
  };

  let catalog;
  let library = {};
  let n = 0;
  const userData = { favorites: [], playtime: {}, lastPlayed: {} };
  let settings = { dataRoot: 'C:\\CanacaLabArcadia', extraRomDirs: {}, emuPaths: {}, defaultEmu: {}, startFullscreen: true, sounds: true, showEmptySystems: true, firstRunDone: true };
  const cloud = {
    cuentas: /nocloud/.test(location.search) ? [] : [{ remoto: 'google1', nombre: 'jugadora@example.com', activa: true }],
    carpetas: [{ id: 'roms-principal', nombre: 'ROMs (Google Drive)', enlace: 'https://drive.google.com/drive/folders/1FakeFolderIdParaPruebas_abcdefgh', cuenta: '', valida: true }]
  };
  const cloudQueue = { current: null, pending: [] };
  const cancelled = new Set();
  if (/auto/.test(location.search)) {
    setTimeout(async () => {
      for (let p = 0; p <= 100; p += 4) { emit('auto:status', { busy: true, label: 'Instalando PCSX2', pct: p }); await wait(400); }
      emit('auto:status', { busy: false, label: null, pct: null });
    }, 800);
  }
  const cloudSt = () => ({ rcloneInstalled: true, cuentas: cloud.cuentas, carpetas: cloud.carpetas, mapeo: {}, descomprimir: true, archivo: 'C:\\CanacaLabArcadia\\config\\nube.json', queue: cloudQueue });
  const installed = { retroarch: true, pcsx2: true, dolphin: true, ppsspp: true, rpcs3: true, xenia: true, xemu: false, shadps4: false, eden: false, ryujinx: false };

  async function loadCatalog() {
    if (catalog) return catalog;
    const sys = await (await fetch('../../config/systems.json')).json();
    const emu = await (await fetch('../../config/emulators.json')).json();
    catalog = { systems: sys.systems, emulators: emu.emulators };
    for (const s of catalog.systems) {
      library[s.id] = (SAMPLE[s.id] || []).map((raw) => {
        const id = `g${++n}`;
        const title = NAMES[raw] || raw.replace(/\s*\([^)]*\)/g, '').trim();
        const region = /\(USA\)/.test(raw) ? 'USA' : /World/.test(raw) ? 'Mundo' : null;
        return { id, system: s.id, title, rawName: raw, path: `C:\\CanacaLabArcadia\\roms\\${s.id}\\${raw}.iso`, size: 1.2e9 + (n * 7.3e7) % 3e9, region, cover: null };
      });
    }
    const now = Date.now();
    const lp = [['ps2', 0, 2.1], ['gamecube', 1, 4.5], ['neogeo', 0, 26], ['n64', 1, 50]];
    for (const [s, i, hrs] of lp) {
      const g = library[s][i];
      userData.lastPlayed[g.id] = new Date(now - hrs * 3600e3).toISOString();
      userData.playtime[g.id] = Math.round(hrs * 1600);
    }
    userData.favorites.push(library.ps2[0].id, library.gamecube[0].id);
    // Juegos que estan en Drive pero no en la Ally.
    const CLOUD = {
      ps2: [['Persona 3 FES (USA)', 4.1e9], ['Devil May Cry 3 (USA)', 3.7e9], ['Zone of the Enders (USA)', 2.2e9]],
      switch: [['Super Smash Bros. Ultimate [01006A800016E000][v0]', 1.6e10, 3], ['Mario Kart 8 Deluxe [0100152000022000][v0]', 1.4e10, 1]],
      xbox360: [['Halo Reach (USA)', 7.2e9]],
      ps3: [["BLUS30443 - Demon's Souls", 5.4e9]],
      gba: [['Pokemon - Emerald Version (USA, Europe)', 1.6e7], ['Metroid Fusion (USA)', 8e6]]
    };
    if (!/nocloud/.test(location.search)) {
      for (const [sys, list] of Object.entries(CLOUD)) {
        cloudGames[sys] = list.map(([raw, size, extras]) => ({
          id: `roms-principal|${sys}|file:${raw}`, cloud: true, system: sys, rawName: raw, size, extras: extras || 0,
          title: raw.replace(/\s*[([][^)\]]*[)\]]/g, '').trim(), cover: null, sourceId: 'roms-principal', folder: sys
        }));
      }
    }
    return catalog;
  }
  const cloudGames = {};

  function status() {
    const out = {};
    for (const s of catalog.systems) {
      const ref = s.emulators[0];
      const ready = installed[ref.emu];
      out[s.id] = ready
        ? { ready: true, emu: ref.emu, label: catalog.emulators[ref.emu].name + (ref.core ? ` · ${ref.core}` : '') }
        : { ready: false, emu: ref.emu, reason: `Falta instalar ${catalog.emulators[ref.emu].name}` };
      if (ready && s.bios && /nobios/.test(location.search)) out[s.id].bios = `Falta el BIOS ${s.bios[0].file}`;
      if (ready && s.id === 'ps3' && /nobios/.test(location.search)) Object.assign(out[s.id], { firmware: true, firmwarePup: null, autoFix: 'El firmware de PS3 se baja de Sony y se instala solo al abrir tu primer juego.' });
    }
    return out;
  }

  function emuStatus() {
    const out = {};
    for (const [id, e] of Object.entries(catalog.emulators)) {
      out[id] = {
        id, name: e.name, desc: e.desc, installed: !!installed[id], auto: e.install.type !== 'manual', homepage: e.homepage,
        warning: e.warning || null, setup: e.setup || null, controls: e.controls || null, folder: `C:\\CanacaLabArcadia\\emulators\\${id}`,
        systems: catalog.systems.filter((s) => s.emulators.some((r) => r.emu === id)).map((s) => s.short)
      };
    }
    return out;
  }

  window.arcadia = {
    __mock: true,
    async init() {
      await loadCatalog();
      const firstRun = /welcome/.test(location.hash);
      return ok({
        version: '1.0.0', platform: 'win32', kiosk: false,
        settings: firstRun ? { ...settings, dataRoot: null, firstRunDone: false } : settings,
        catalog, library, status: status(), userData, comboAvailable: true, suggestedRoot: 'C:\\CanacaLabArcadia',
        cloudGames, cloudInfo: { connected: cloud.cuentas.length > 0, hasFolders: true, at: new Date().toISOString() },
        auto: null
      });
    },
    updateSettings: (p) => { settings = { ...settings, ...p }; return ok(settings); },
    scan: () => ok({ library, status: status() }),
    async launch(id) {
      let game;
      for (const l of Object.values(library)) game = game || l.find((g) => g.id === id);
      const st = status()[game.system];
      if (!st.ready) {
        // Se instala solo y luego abre el juego.
        for (let p = 0; p <= 100; p += 10) {
          if (cancelled.has(id)) { cancelled.delete(id); return { ok: false, error: 'Cancelado', code: 'CANCELLED' }; }
          emit('launch:prep', { id, phase: `Instalando ${catalog.emulators[st.emu].name} (solo la primera vez)`, pct: p });
          await wait(300);
        }
        installed[st.emu] = true;
        return window.arcadia.launch(id);
      }
      if (st.bios) return { ok: false, error: 'Falta el BIOS neogeo.zip. Súbelo a la carpeta BIOS de tu Google Drive y descárgalo en Menú > Nube, o cópialo en C:\\CanacaLabArcadia\\roms\\neogeo.', code: 'NO_BIOS' };
      setTimeout(() => emit('game:started', { id }), 400);
      setTimeout(() => {
        userData.playtime[id] = (userData.playtime[id] || 0) + 2520;
        userData.lastPlayed[id] = new Date().toISOString();
        emit('game:ended', { id, seconds: 2520, code: 0, userData });
      }, 2600);
      return ok({ emulator: st.label });
    },
    stop: () => ok(true),
    cancelLaunch: (id) => { cancelled.add(id); return ok(true); },
    cloudGames: () => ok({ games: cloudGames, info: { connected: cloud.cuentas.length > 0, hasFolders: true } }),
    cloudRefresh: () => ok({ games: cloudGames, info: { connected: true, hasFolders: true } }),
    async cloudPlay(id) {
      let g;
      for (const l of Object.values(cloudGames)) g = g || l.find((x) => x.id === id);
      if (!g) return { ok: false, error: 'Ese juego ya no está en tu Google Drive.' };
      (async () => {
        await wait(400);
        const job = { id, name: g.title, system: g.system, state: 'descargando', bytes: 0, total: g.size, speed: 4.1e7, eta: 90, play: true };
        cloudQueue.current = job;
        for (let p = 0; p <= 100; p += 5) {
          job.bytes = (g.size * p) / 100; job.eta = Math.round((100 - p) * 0.9);
          emit('cloud:progress', { ...job }); emit('cloud:queue', cloudQueue);
          await wait(/slow/.test(location.search) ? 1500 : 220);
        }
        cloudQueue.current = null;
        cloudGames[g.system] = cloudGames[g.system].filter((x) => x.id !== id);
        const local = { id: `g${++n}`, system: g.system, title: g.title, rawName: g.rawName, path: `C:\\CanacaLabArcadia\\roms\\${g.system}\\${g.rawName}`, size: g.size, cover: null };
        library[g.system].push(local);
        library[g.system].sort((a, b) => a.title.localeCompare(b.title));
        emit('cloud:queue', cloudQueue);
        emit('cloud:done', { id, name: g.title, system: g.system, ok: true, play: true, library, status: status(), cloudGames, playGameId: local.id });
      })();
      return ok({ id, name: g.title, system: g.system, size: g.size });
    },
    favorite(id) {
      const i = userData.favorites.indexOf(id);
      if (i >= 0) userData.favorites.splice(i, 1); else userData.favorites.push(id);
      return ok({ favorite: i < 0, userData });
    },
    reveal: () => ok(true),
    emuStatus: () => ok(emuStatus()),
    async emuInstall(id) {
      for (let p = 0; p <= 100; p += 20) {
        emit('emu:progress', { emu: id, phase: p < 100 ? `Descargando ${catalog.emulators[id].name}` : 'Listo', pct: p });
        await wait(250);
      }
      installed[id] = true;
      return ok({ exe: 'C:\\CanacaLabArcadia\\emulators\\' + id, status: status() });
    },
    emuLocate: (id) => { installed[id] = true; return ok({ exe: 'C:\\x.exe', status: status() }); },
    emuOpen: () => ok(true),
    emuHomepage: () => ok(true),
    emuSetDefault: (s, k) => ok(settings),
    openFolder: () => ok(''),
    chooseRoot: (p) => { settings.dataRoot = p || 'D:\\Juegos\\CanacaLabArcadia'; settings.firstRunDone = true; return ok({ settings, library, status: status(), userData }); },
    addRomDir: () => ok(null),
    removeRomDir: () => ok({ settings, library }),
    importPlan: () => ok(samplePlan()),
    importPick: () => ok(samplePlan()),
    async importRun(items) {
      for (let p = 0; p <= 100; p += 10) { emit('import:progress', { pct: p }); await wait(120); }
      return ok({ report: { added: items.filter((i) => i.system), skipped: [], failed: [] }, library, status: status() });
    },
    async fetchCovers() { return ok({ found: 0, missing: 0, total: 0, library }); },
    coversConfig: () => ok({ screenscraper: { usuario: '', clave: false, devid: '', devclave: false }, igdb: { clientId: '', clientSecret: false }, activas: ['libretro'] }),
    async coversSaveConfig(p) {
      await wait(500);
      const has = p.igdb && p.igdb.clientId && p.igdb.clientSecret;
      return ok({ config: { screenscraper: { usuario: p.screenscraper.usuario, clave: !!p.screenscraper.clave, devid: '', devclave: false }, igdb: { clientId: p.igdb.clientId, clientSecret: !!has }, activas: has ? ['igdb', 'libretro'] : ['libretro'] }, test: has ? { igdb: 'ok' } : {} });
    },
    coversOpenSite: () => ok(true),
    firewall: (block) => { settings = { ...settings, emulatorsOffline: !!block }; return ok(settings); },
    async cloudStatus() { return ok(cloudSt()); },
    async cloudConnect() {
      emit('cloud:setup', { phase: 'Descargando rclone', pct: 60 }); await wait(300);
      emit('cloud:authLink', { url: 'http://127.0.0.1:53682/auth?state=demo' }); await wait(900);
      cloud.cuentas.push({ remoto: `google${cloud.cuentas.length + 1}`, nombre: 'jugadora@example.com', activa: true });
      return ok(cloudSt());
    },
    cloudCancelConnect: () => ok(true),
    cloudRemoveAccount: (r) => { cloud.cuentas = cloud.cuentas.filter((c) => c.remoto !== r); return ok(cloudSt()); },
    cloudSaveSource: (src) => { cloud.carpetas.push({ ...src, id: `c${Date.now()}`, valida: true }); return ok(cloudSt()); },
    cloudRemoveSource: (id) => { cloud.carpetas = cloud.carpetas.filter((c) => c.id !== id); return ok(cloudSt()); },
    cloudSetMapping: () => ok(cloudSt()),
    async cloudFolders() {
      await wait(250);
      const map = { 'Nintendo Switch': 'switch', 'Sega Genesis': 'genesis', PS2: 'ps2', PS1: 'ps1', PS4: 'ps4', BIOS: 'bios', 'Game Boy Advance': 'gba', 'Game Boy Color': 'gb', 'Game Boy': 'gb', Arcade: 'mame', PC: null, 'Nintendo DS': 'nds', 'Nintendo 64': 'n64', 'Super Nintendo': 'snes', NES: 'nes', 'Neo Geo': 'neogeo', MAME: 'mame', 'Xbox 360': 'xbox360', Xbox: 'xbox', PSP: 'psp' };
      const folders = Object.entries(map).map(([name, system]) => ({ name, path: name, system, supported: !!system })).sort((a, b) => a.name.localeCompare(b.name));
      return ok({ source: cloud.carpetas[0], folders });
    },
    async cloudItems(src, folder, system) {
      await wait(250);
      const names = { PS2: [['Okami (USA).iso', 4.2e9], ['Shadow of the Colossus (USA).iso', 3.9e9], ['Ico (USA).7z', 6.1e8], ['Kingdom Hearts II (USA).iso', 3.6e9]], PS4: [['CUSA00900', 4.6e10, 'dir']], BIOS: [['scph5501.bin', 524288], ['neogeo.zip', 2.1e5]], 'Neo Geo': [['mslug.zip', 1.2e7], ['kof98.zip', 4.4e7]] };
      const list = (names[folder] || [['Juego de ejemplo (USA).zip', 2.4e6]]).map(([name, size, kind], i) => ({ id: `${folder}|${name}`, name, size, kind: kind || 'files', path: name, files: [name], downloaded: i === 0 && folder === 'PS2' }));
      return ok({ source: cloud.carpetas[0], folder, system, items: list });
    },
    async cloudDownload(src, folder, system, units) {
      (async () => {
        for (const u of units) {
          cloudQueue.current = { id: u.id, name: u.name, state: 'descargando', bytes: 0, total: u.size, speed: 3.2e7 };
          for (let p = 0; p <= 100; p += 20) { cloudQueue.current.bytes = (u.size * p) / 100; emit('cloud:progress', { ...cloudQueue.current }); emit('cloud:queue', cloudQueue); await wait(300); }
          cloudQueue.current = null;
          emit('cloud:done', { id: u.id, name: u.name, ok: true });
          emit('cloud:queue', cloudQueue);
        }
      })();
      return ok(units.length);
    },
    cloudCancel: () => ok(true),
    cloudOpenLink: () => ok(true),
    cloudOpenConfig: () => ok(true),
    quit: () => ok(true),
    toggleFullscreen: () => ok(true),
    focusWindow: () => ok(true),
    emuInstallFirmware: () => ok({ installed: true, status: status() }),
    emuFirmwarePage: () => ok(true),
    pathForFile: (f) => f.name,
    on(ch, fn) { (listeners[ch] = listeners[ch] || []).push(fn); return () => {}; }
  };

  function samplePlan() {
    return [
      { index: 0, name: 'Persona 3 FES (USA).iso', src: 'E:\\Respaldo\\Persona 3 FES (USA).iso', system: 'ps2', confidence: 'alta', reason: 'Disco de PS2 (SYSTEM.CNF con BOOT2)', size: 4.1e9 },
      { index: 1, name: 'Paper Mario TTYD (USA).rvz', src: 'E:\\Respaldo\\Paper Mario TTYD (USA).rvz', system: 'gamecube', confidence: 'alta', reason: 'Imagen RVZ de GameCube', size: 1.1e9 },
      { index: 2, name: 'Spyro the Dragon (USA).cue', src: 'E:\\Respaldo\\Spyro the Dragon (USA).cue', system: 'ps1', confidence: 'alta', reason: 'Disco de PS1 (SYSTEM.CNF con BOOT)', size: 2e3, companions: ['Spyro the Dragon (USA).bin'] },
      { index: 3, name: 'Halo 2 (USA).iso', src: 'E:\\Respaldo\\Halo 2 (USA).iso', system: 'xbox', confidence: 'alta', reason: 'Disco de Xbox completo (redump)', needsXiso: true, size: 7.8e9 },
      { index: 4, name: 'Valkyrie Profile.chd', src: 'E:\\Respaldo\\Valkyrie Profile.chd', system: null, confidence: 'baja', reason: 'Las imagenes .chd no dicen su consola: elige una', candidates: ['ps1', 'ps2', 'psp', 'mame'], size: 6e8 },
      { index: 5, name: 'mslugx.zip', src: 'E:\\Respaldo\\mslugx.zip', system: 'neogeo', confidence: 'alta', reason: 'Romset de Neo Geo (piezas p1/c1/s1/m1/v1)', size: 4e7 }
    ];
  }
})();
