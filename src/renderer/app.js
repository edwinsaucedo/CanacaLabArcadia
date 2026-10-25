/* CanacaLabArcadia — interfaz. Todo se maneja con control (Gamepad API), teclado, mouse o tactil. */
(() => {
  'use strict';

  const api = window.arcadia;

  // ------------------------------------------------------------------ utilidades

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const $ = (s, el = document) => el.querySelector(s);

  async function call(fn, ...args) {
    const r = await fn(...args);
    if (!r || !r.ok) {
      const e = new Error((r && r.error) || 'Algo falló');
      e.code = r && r.code;
      throw e;
    }
    return r.data;
  }

  function fmtSize(b) {
    if (!b) return null;
    if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB`;
    if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
    return `${Math.max(1, Math.round(b / 1e3))} KB`;
  }

  function fmtPlay(sec) {
    if (!sec) return null;
    const m = Math.round(sec / 60);
    if (m < 60) return `${Math.max(1, m)} min jugados`;
    const hrs = Math.floor(m / 60);
    return hrs === 1 ? '1 hora jugada' : `${hrs} horas jugadas`;
  }

  function fmtDuration(sec) {
    const m = Math.max(1, Math.round(sec / 60));
    if (m < 60) return `${m} min`;
    const hrs = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${hrs} h ${rest} min` : `${hrs} h`;
  }

  // Con mouse o tactil, el primer toque selecciona y el segundo abre (como en una consola).
  // Con control o teclado, A abre directamente.
  let pointerWasFocused = false;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('.f');
    pointerWasFocused = !!el && el === state.focusEl;
  }, true);
  function twoStep(fn) {
    return (ev) => {
      if (ev && ev.detail > 0 && !pointerWasFocused) return;
      fn(ev);
    };
  }

  function fmtAgo(iso) {
    if (!iso) return null;
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return 'Hace un momento';
    if (d < 86400) return `Hace ${Math.round(d / 3600)} h`;
    const days = Math.round(d / 86400);
    return days === 1 ? 'Ayer' : `Hace ${days} días`;
  }

  const media = (p) => (api.__mock ? null : `arcadia-media://m/?p=${encodeURIComponent(p)}`);

  // Proporcion de la caja original de cada consola (para que las portadas no se deformen).
  const BOX = {
    nes: 0.72, snes: 1.38, n64: 1.38, gb: 0.98, gba: 0.98, nds: 0.9, gamecube: 0.71, wii: 0.71, switch: 0.62,
    genesis: 0.72, ps1: 1, ps2: 0.71, ps3: 0.8, ps4: 0.8, psp: 0.58, xbox: 0.71, xbox360: 0.71, mame: 0.75, neogeo: 0.72
  };
  const LANDSCAPE = new Set(['snes', 'n64']);

  // ------------------------------------------------------------------ estado

  const state = {
    settings: null,
    catalog: null,
    library: {},
    status: {},
    userData: { favorites: [], playtime: {}, lastPlayed: {} },
    emu: null,
    stack: [],
    focusKey: {},
    focusEl: null,
    layers: [],
    installing: {},
    playing: null,
    comboAvailable: false,
    suggestedRoot: 'C:\\CanacaLabArcadia',
    // Juegos que estan en tu Google Drive y aun no en la Ally: { consola: [juego] }
    cloudGames: {},
    cloudInfo: { connected: false, hasFolders: false, at: null },
    auto: null,
    prep: null
  };

  const sysById = (id) => state.catalog.systems.find((s) => s.id === id);
  const localGames = (id) => state.library[id] || [];
  const cloudOf = (id) => state.cloudGames[id] || [];
  // Lo que tienes en la Ally y lo que esta en tu Drive, juntos y en orden alfabetico.
  const titleKey = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function games(id) {
    const cloudList = cloudOf(id);
    if (!cloudList.length) return localGames(id);
    return [...localGames(id), ...cloudList].sort((a, b) => titleKey(a.title).localeCompare(titleKey(b.title), 'es', { numeric: true }));
  }
  const isFav = (id) => state.userData.favorites.includes(id);
  const view = () => state.stack[state.stack.length - 1] || { name: 'home' };

  function setAccent(color) {
    document.documentElement.style.setProperty('--acento', color || '#6c8cff');
    // Texto oscuro sobre colores claros (Game Boy, Neo Geo...) para que el boton se lea bien.
    const c = (color || '#6c8cff').replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    document.documentElement.style.setProperty('--acento-texto', lum > 0.62 ? '#10141d' : '#ffffff');
  }

  // ------------------------------------------------------------------ sonido

  let audio = null;
  function blip(kind) {
    if (!state.settings || !state.settings.sounds) return;
    try {
      audio = audio || new AudioContext();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      const f = { move: 660, ok: 880, back: 440, err: 220 }[kind] || 660;
      o.type = kind === 'err' ? 'square' : 'sine';
      o.frequency.setValueAtTime(f, t);
      if (kind === 'ok') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.07);
      g.gain.setValueAtTime(kind === 'move' ? 0.025 : 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'move' ? 0.05 : 0.12));
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.14);
    } catch { /* sin audio */ }
  }

  // ------------------------------------------------------------------ foco y navegacion

  function scope() {
    const top = state.layers[state.layers.length - 1];
    return top ? top.el : $('#screen');
  }

  function focusables(root = scope()) {
    return [...root.querySelectorAll('.f')].filter((el) => el.getClientRects().length && !el.disabled);
  }

  function setFocus(el, { silent = false, scroll = true } = {}) {
    if (!el) return;
    if (state.focusEl && state.focusEl !== el) state.focusEl.classList.remove('focus');
    state.focusEl = el;
    el.classList.add('focus');
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (scroll) {
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (el.classList.contains('spine')) {
        // El lomo crece al enfocarse: se centra cuando termina de abrirse.
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
        clearTimeout(setFocus.t);
        setFocus.t = setTimeout(() => state.focusEl === el && el.scrollIntoView({ block: 'nearest', inline: 'center', behavior }), 260);
      } else {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
      }
    }
    const key = el.dataset.key;
    if (key && !state.layers.length) state.focusKey[viewId()] = key;
    if (el._onFocus) el._onFocus();
    if (!silent) blip('move');
  }

  function viewId() {
    const v = view();
    return v.name + (v.system ? `:${v.system}` : '') + (v.tab ? `:${v.tab}` : '');
  }

  function rectCenter(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function move(dir) {
    const items = focusables();
    if (!items.length) return;
    const cur = state.focusEl && scope().contains(state.focusEl) && state.focusEl.getClientRects().length ? state.focusEl : null;
    if (!cur) return setFocus(items[0]);
    if (cur._nav && cur._nav(dir) !== false) return;
    const r0 = cur.getBoundingClientRect();
    const c0 = rectCenter(r0);
    let best = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const c = rectCenter(r);
      let primary;
      let cross;
      if (dir === 'left' || dir === 'right') {
        primary = dir === 'right' ? r.left - r0.right : r0.left - r.right;
        if ((dir === 'right' && c.x <= c0.x + 2) || (dir === 'left' && c.x >= c0.x - 2)) continue;
        cross = Math.max(0, Math.max(r.top, r0.top) - Math.min(r.bottom, r0.bottom) > 0 ? Math.abs(c.y - c0.y) : 0);
      } else {
        primary = dir === 'down' ? r.top - r0.bottom : r0.top - r.bottom;
        if ((dir === 'down' && c.y <= c0.y + 2) || (dir === 'up' && c.y >= c0.y - 2)) continue;
        const overlap = Math.min(r.right, r0.right) - Math.max(r.left, r0.left);
        cross = overlap > 0 ? 0 : Math.abs(c.x - c0.x);
      }
      const score = Math.max(primary, -40) + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }

  function activate() {
    const el = state.focusEl;
    if (!el || !scope().contains(el)) return;
    blip('ok');
    el.click();
  }

  function restoreFocus(fallbackSelector) {
    const key = state.focusKey[viewId()];
    const root = scope();
    const el = (key && root.querySelector(`[data-key="${CSS.escape(key)}"]`)) || (fallbackSelector && root.querySelector(fallbackSelector)) || focusables(root)[0];
    // Quitar marcas de foco que hayan quedado de antes de abrir una hoja.
    root.querySelectorAll('.focus').forEach((x) => x !== el && x.classList.remove('focus'));
    if (el) setFocus(el, { silent: true });
  }

  // ------------------------------------------------------------------ entrada: control y teclado

  const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
  const prev = {};
  const held = {};
  let lastPadSeen = 0;

  function action(name) {
    document.body.classList.add('mouse-hidden');
    if (['up', 'down', 'left', 'right'].includes(name)) return move(name);
    const top = state.layers[state.layers.length - 1];
    if (top) {
      // Con una hoja abierta solo cuentan sus propios botones, A y B.
      if (top.onAction && top.onAction(name) !== false) return;
      if (name === 'a') return activate();
      if (name === 'b') return back();
      return;
    }
    if (name === 'a') return activate();
    if (name === 'b') return back();
    const v = view();
    if (v.onAction && v.onAction(name) !== false) return;
    if (name === 'start') return openSettings();
  }

  let focusAsked = false;
  function pollPads() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const now = performance.now();
    const pressed = {};
    for (const p of pads) {
      lastPadSeen = now;
      for (const [name, i] of Object.entries(BTN)) if (p.buttons[i] && p.buttons[i].pressed) pressed[name] = true;
      const [lx, ly] = [p.axes[0] || 0, p.axes[1] || 0];
      if (lx < -0.55) pressed.left = true;
      if (lx > 0.55) pressed.right = true;
      if (ly < -0.55) pressed.up = true;
      if (ly > 0.55) pressed.down = true;
    }
    const fresh = Object.keys(BTN).filter((n) => pressed[n] && !prev[n]);
    if (!document.hasFocus() && fresh.length && !state.playing && !focusAsked) {
      // La ventana se quedo sin foco (otra app, la bandeja de Windows...): se trae al frente y el boton cuenta.
      focusAsked = true;
      api.focusWindow().then((r) => {
        focusAsked = false;
        if (r && r.ok && r.data) fresh.forEach((n) => action(n));
      });
    }
    if (document.hasFocus()) {
      for (const name of Object.keys(BTN)) {
        const isDir = ['up', 'down', 'left', 'right'].includes(name);
        if (pressed[name] && !prev[name]) {
          held[name] = now + 380;
          action(name);
        } else if (pressed[name] && isDir && now >= held[name]) {
          held[name] = now + 85;
          action(name);
        }
      }
    }
    for (const name of Object.keys(BTN)) prev[name] = !!pressed[name];
    updatePadState(pads);
    if (state.layers.length && state.layers[state.layers.length - 1].onFrame) state.layers[state.layers.length - 1].onFrame(pads);
    if (view().onFrame) view().onFrame(pads);
    requestAnimationFrame(pollPads);
  }

  function updatePadState(pads) {
    const el = $('#pad-state');
    const name = pads[0] ? 'Control conectado' : 'Sin control';
    if (el.textContent !== name) {
      el.textContent = name;
      el.classList.toggle('off', !pads[0]);
    }
  }

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', ' ': 'a',
    Escape: 'b', Backspace: 'b', f: 'y', F: 'y', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', m: 'start', M: 'start', i: 'back', I: 'back',
    PageUp: 'lb', PageDown: 'rb', F1: 'start', '/': 'x'
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F11') { api.toggleFullscreen(); ev.preventDefault(); return; }
    // Dentro de un campo de texto se escribe normal; solo Esc, Tab y flechas arriba/abajo navegan.
    if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.target.blur(); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); move(ev.key === 'ArrowUp' ? 'up' : 'down'); }
      else if (ev.key === 'Enter') { ev.preventDefault(); move('down'); }
      return;
    }
    const a = KEYS[ev.key];
    if (a) {
      ev.preventDefault();
      action(a);
    } else if (ev.key.length === 1 && /[a-z0-9]/i.test(ev.key) && (view().name === 'system' || (view().name === 'home' && state.settings.homeGames))) {
      jumpToLetter(ev.key.toUpperCase());
    }
  });

  window.addEventListener('mousemove', () => document.body.classList.remove('mouse-hidden'));
  // Con mouse, pasar el puntero encima selecciona (asi un solo clic abre). En pantalla tactil siguen siendo dos toques.
  let hoverAt = 0;
  document.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' || state.playing) return;
    const now = performance.now();
    if (now - hoverAt < 60) return;
    hoverAt = now;
    const el = ev.target.closest && ev.target.closest('.f');
    if (el && el !== state.focusEl && scope().contains(el) && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) setFocus(el, { silent: true, scroll: false });
  });
  // Rueda del mouse: en la fila de consolas y en las pestanas se mueve de lado; en listas, desplaza normal.
  let wheelAt = 0;
  window.addEventListener('wheel', (ev) => {
    const shelf = ev.target.closest && ev.target.closest('.shelf');
    if (!shelf || state.layers.length) return;
    ev.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 140) return;
    wheelAt = now;
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (d) action(d > 0 ? 'right' : 'left');
  }, { passive: false });
  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest && ev.target.closest('.f');
    if (el && el !== state.focusEl && scope().contains(el)) setFocus(el, { silent: true, scroll: false });
  });

  // ------------------------------------------------------------------ barra de botones

  const ICON_VIEW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="8" rx="1.5"/><rect x="6" y="6" width="8" height="8" rx="1.5"/></svg>';
  const ICON_MENU = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4h10M3 8h10M3 12h10"/></svg>';

  function glyph(btn) {
    if (btn === 'view') return h('span', { class: 'glyph wide', html: ICON_VIEW });
    if (btn === 'menu') return h('span', { class: 'glyph wide', html: ICON_MENU });
    if (btn === 'lb' || btn === 'rb') return h('span', { class: 'glyph wide' }, btn.toUpperCase());
    return h('span', { class: `glyph ${btn}` }, btn.toUpperCase());
  }

  function hints(list, right = []) {
    const bar = $('#hints');
    bar.replaceChildren(...[
      ...list.map(([b, label, fn]) => h('span', { class: 'hint' }, fn ? h('button', { onclick: fn }, glyph(b), label) : [glyph(b), label])),
      right.length ? h('span', { class: 'push' }) : null,
      ...right.map(([b, label, fn]) => h('span', { class: 'hint' }, fn ? h('button', { onclick: fn }, glyph(b), label) : [glyph(b), label]))
    ].filter(Boolean));
  }

  // ------------------------------------------------------------------ portadas

  function coverEl(game, sys, { contain = false } = {}) {
    // Cada portada generada varia un poco (tono y franja) segun el titulo, para que la cuadricula no se vea plana.
    let hash = 0;
    for (const ch of game.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const mix = `${14 + (hash % 23)}%`;
    const stripe = `${76 + ((hash >> 4) % 11)}%`;
    const gen = () => h('div', { class: 'cover gen', vars: { '--c': sys.color, '--mix': mix, '--stripe': stripe } },
      h('div', { class: 'gt' }, game.title),
      h('div', { class: 'gs' }, sys.short));
    if (!game.cover || !media(game.cover)) return gen();
    const box = h('div', { class: `cover${contain ? ' contain' : ''}` });
    const img = h('img', { src: media(game.cover), alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => box.replaceWith(gen()));
    box.append(img);
    return box;
  }

  // ------------------------------------------------------------------ navegacion entre pantallas

  function go(v) {
    state.stack.push(v);
    render();
  }

  function back() {
    if (state.layers.length) {
      const top = state.layers[state.layers.length - 1];
      if (top.cancelable === false) return;
      blip('back');
      return closeLayer();
    }
    if (state.stack.length <= 1) return;
    blip('back');
    state.stack.pop();
    render();
  }

  function render() {
    const v = view();
    const screen = $('#screen');
    document.body.classList.toggle('is-welcome', v.name === 'welcome');
    state.focusEl = null;
    screen.replaceChildren();
    if (v.name === 'welcome') renderWelcome(screen);
    else if (v.name === 'home') renderHome(screen);
    else if (v.name === 'system') renderSystem(screen, v);
    else if (v.name === 'settings') renderSettings(screen, v);
    else if (v.name === 'cloud') renderCloud(screen, v);
  }

  function openSettings(tab = 'emuladores') {
    if (view().name === 'settings') return;
    go({ name: 'settings', tab });
  }

  // ------------------------------------------------------------------ bienvenida

  function renderWelcome(screen) {
    setAccent('#6c8cff');
    const colors = state.catalog.systems.map((s) => s.color);
    const root = state.suggestedRoot;
    screen.append(h('section', { class: 'welcome' },
      h('div', { class: 'mini-shelf', 'aria-hidden': 'true' }, colors.map((c) => h('i', { style: { background: c } }))),
      h('h1', {}, 'CanacaLabArcadia'),
      h('p', {}, 'Todas tus consolas en una sola pantalla. Primero elige dónde vivirá tu biblioteca: ahí se guardan tus juegos, los emuladores y tus partidas.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary f', 'data-key': 'root-default', onclick: () => chooseRoot(root) }, `Usar ${root}`),
        h('button', { class: 'btn f', onclick: () => chooseRoot(null) }, 'Elegir otra carpeta')),
      h('p', { style: { fontSize: '1rem' } }, 'Si tus juegos están en la microSD, elige una carpeta ahí. Puedes cambiarla después en Menú > Biblioteca.')));
    hints([['a', 'Elegir']]);
    restoreFocus('[data-key="root-default"]');
  }

  async function chooseRoot(p) {
    try {
      const r = await call(api.chooseRoot, p);
      if (!r) return;
      Object.assign(state, { settings: r.settings, library: r.library, status: r.status });
      if (r.userData) state.userData = r.userData;
      if (r.cloudGames) state.cloudGames = r.cloudGames;
      if (r.cloudInfo) state.cloudInfo = r.cloudInfo;
      state.stack = [{ name: 'home' }];
      render();
      toast('Biblioteca lista. CanacaLabArcadia instala sola lo que haga falta.');
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------------ inicio

  function systemsToShow() {
    const all = state.catalog.systems;
    if (state.settings.showEmptySystems) return all;
    const withGames = all.filter((s) => games(s.id).length);
    return withGames.length ? withGames : all;
  }

  function readyLine(sys) {
    const st = state.status[sys.id] || {};
    if (st.ready && st.bios) return h('div', { class: 'ready' }, h('span', { class: 'dot warn' }), st.bios);
    if (st.ready) return h('div', { class: 'ready' }, h('span', { class: 'dot' }), `Listo con ${st.label.split(' · ')[0]}`);
    return h('div', { class: 'ready' }, h('span', { class: 'dot warn' }), st.reason || 'Falta el emulador');
  }

  // Pestañas de la pantalla principal: Consolas (estante) o Juegos (todos juntos). LB / RB cambia.
  function homeTabs(active) {
    const tab = (id, label) => h('button', {
      class: `vtab f${active === id ? ' on' : ''}`, 'data-key': `vtab:${id}`, role: 'tab', 'aria-selected': String(active === id),
      onclick: () => setHomeView(id === 'games')
    }, label);
    return h('nav', { class: 'home-tabs', role: 'tablist', 'aria-label': 'Vista' }, glyph('lb'), tab('consoles', 'Consolas'), tab('games', 'Juegos'), glyph('rb'));
  }

  async function setHomeView(gamesView) {
    if (!!state.settings.homeGames === gamesView) return;
    blip('move');
    state.settings = { ...state.settings, homeGames: gamesView };
    if (view().name === 'home') render();
    try {
      state.settings = await call(api.updateSettings, { homeGames: gamesView });
    } catch { /* se queda solo en esta sesion */ }
  }

  function renderHome(screen) {
    if (state.settings.homeGames) return renderGamesHome(screen);
    const list = systemsToShow();
    const shelf = h('div', { class: 'shelf', role: 'listbox', 'aria-label': 'Consolas' });
    for (const sys of list) {
      const count = games(sys.id).length;
      const inCloud = cloudOf(sys.id).length;
      const recent = localGames(sys.id).slice().sort((a, b) => (state.userData.lastPlayed[b.id] || '').localeCompare(state.userData.lastPlayed[a.id] || '')).slice(0, 4);
      const spine = h('button', {
        class: `spine f${count ? '' : ' empty'}`, 'data-key': `sys:${sys.id}`, vars: { '--c': sys.color },
        'aria-label': `${sys.name}, ${count} juegos`,
        onclick: twoStep(() => go({ name: 'system', system: sys.id }))
      },
      h('div', { class: 'band' }, h('span', {}, sys.maker)),
      h('div', { class: 'vname' }, sys.short),
      h('div', { class: 'vcount' }, count || ''),
      h('div', { class: 'open' },
        h('div', { class: 'maker' }, `${sys.maker}, ${sys.year}`),
        h('div', { class: 'name' }, sys.name),
        h('div', { class: 'facts' }, h('span', {}, h('b', {}, count), count === 1 ? ' juego' : ' juegos'), inCloud ? h('span', {}, `${inCloud} en tu Drive`) : null, h('span', {}, sys.gen)),
        h('div', { style: { display: 'grid', gap: '0.9rem' } },
          count ? h('div', { class: 'peek' }, recent.map((g) => h('div', { class: 'mini' }, coverEl(g, sys)))) : null,
          readyLine(sys))));
      spine._onFocus = () => { setAccent(sys.color); state.lastSpine = `sys:${sys.id}`; };
      shelf.append(spine);
    }

    const recents = Object.entries(state.userData.lastPlayed)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([id]) => findGame(id))
      .filter(Boolean)
      .slice(0, 6);

    const recentEl = recents.length
      ? h('section', { class: 'recent' },
        h('h3', {}, 'Seguir jugando'),
        h('div', { class: 'recent-row' }, recents.map((g) => {
          const sys = sysById(g.system);
          const el = h('button', { class: 'recent-item f', 'data-key': `recent:${g.id}`, onclick: twoStep(() => launch(g)) },
            h('div', { class: 'cov' }, coverEl(g, sys)),
            h('div', {}, h('div', { class: 't' }, g.title), h('div', { class: 's' }, `${sys.short}, ${fmtAgo(state.userData.lastPlayed[g.id]) || ''}`)));
          el._onFocus = () => setAccent(sys.color);
          // Desde "Seguir jugando", arriba regresa a la consola donde estabas, no a la que quede encima.
          el._nav = (dir) => {
            if (dir !== 'up') return false;
            const back = state.lastSpine && $(`[data-key="${CSS.escape(state.lastSpine)}"]`);
            if (!back) return false;
            setFocus(back);
            return true;
          };
          return el;
        })))
      : h('section', { class: 'recent' }, h('h3', {}, 'Elige una consola para empezar. Los juegos que abras aparecerán aquí.'));

    screen.append(h('section', { class: 'home' }, homeTabs('consoles'), cloudStrip(), shelf, recentEl));
    view().onAction = (a) => {
      if (a === 'back') { openImport(); return true; }
      if (a === 'lb' || a === 'rb') { setHomeView(true); return true; }
      return false;
    };
    hints([['a', 'Abrir'], ['menu', 'Menú', () => openSettings()]], [['rb', 'Ver por juegos', () => setHomeView(true)], ['view', 'Agregar juegos', () => openImport()]]);
    const firstWithGames = list.find((s) => games(s.id).length);
    restoreFocus(firstWithGames ? `[data-key="sys:${firstWithGames.id}"]` : '.spine');
  }

  // ------------------------------------------------------------------ inicio por juegos

  const sortTitle = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|el|la|los|las)\s+/i, '').toLowerCase();

  function allGames() {
    return state.catalog.systems.flatMap((s) => games(s.id));
  }

  function renderGamesHome(screen) {
    const all = allGames();
    const consoles = state.catalog.systems.filter((s) => games(s.id).length);
    let filter = state.gamesFilter || 'all';
    if (filter.startsWith('sys:') && !games(filter.slice(4)).length) filter = 'all';
    const last = state.userData.lastPlayed;
    let list;
    if (filter === 'fav') list = all.filter((g) => isFav(g.id));
    else if (filter === 'recent') list = all.filter((g) => last[g.id]).sort((a, b) => last[b.id].localeCompare(last[a.id]));
    else if (filter.startsWith('sys:')) list = games(filter.slice(4)).slice();
    else list = all.slice();
    if (filter !== 'recent') list.sort((a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title), 'es'));
    state.gamesList = list;

    const chip = (id, label, color) => {
      const el = h('button', {
        class: `fchip f${filter === id ? ' on' : ''}`, 'data-key': `filter:${id}`, vars: color ? { '--c': color } : {},
        onclick: () => {
          state.gamesFilter = id;
          state.focusKey[viewId()] = `filter:${id}`;
          render();
        }
      }, color ? h('span', { class: 'dot' }) : null, label);
      return el;
    };
    const filters = h('div', { class: 'filters', role: 'toolbar', 'aria-label': 'Filtrar juegos' },
      chip('all', `Todos · ${all.length}`),
      chip('fav', '\u2605 Favoritos'),
      chip('recent', 'Jugados hace poco'),
      ...consoles.map((s) => chip(`sys:${s.id}`, `${s.short} · ${games(s.id).length}`, s.color)));

    const head = h('header', { class: 'sys-head games-head' },
      homeTabs('games'),
      h('span', { class: 'count' }, list.length === 1 ? '1 juego' : `${list.length} juegos`),
      h('div', { class: 'push' },
        h('button', { class: 'btn ghost small f', 'data-key': 'add', onclick: () => openImport() }, 'Agregar juegos'),
        h('button', { class: 'btn ghost small f', 'data-key': 'cloud', onclick: () => openCloud(null) }, 'Descargar de la nube')));

    const body = h('div', { class: 'sys-body' });
    screen.append(h('section', { class: 'system games-home' }, head, all.length ? filters : cloudStrip() || h('div'), body));

    if (!all.length) {
      body.style.gridTemplateColumns = '1fr';
      body.append(h('div', { class: 'empty-state' },
        h('h2', {}, 'Aún no tienes juegos'),
        h('p', {}, 'Agrégalos desde una carpeta o USB, o descárgalos de tu Google Drive. Aquí aparecen todos juntos, de todas tus consolas.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary f', 'data-key': 'empty-add', onclick: () => openImport() }, 'Agregar juegos'),
          h('button', { class: 'btn f', onclick: () => openCloud(null) }, 'Descargar de Google Drive'),
          h('button', { class: 'btn f', onclick: () => setHomeView(false) }, 'Ver consolas'))));
    } else if (!list.length) {
      body.style.gridTemplateColumns = '1fr';
      body.append(h('div', { class: 'empty-state' },
        h('h2', {}, filter === 'fav' ? 'Todavía no tienes favoritos' : 'Todavía no has jugado nada'),
        h('p', {}, filter === 'fav' ? 'En cualquier juego presiona Y para marcarlo como favorito.' : 'Los juegos que abras aparecerán aquí, del más reciente al más antiguo.')));
    } else {
      const detail = h('aside', { class: 'detail' });
      const grid = h('div', { class: 'grid', vars: { '--cell': '9.5rem' } });
      const wrap = h('div', { class: 'grid-wrap' }, grid);
      body.append(detail, wrap);
      for (const g of list) {
        const sys = sysById(g.system);
        const st = state.status[g.system] || {};
        const t = h('button', { class: `tile f${g.cloud ? ' in-cloud' : ''}`, 'data-key': `game:${g.id}`, 'aria-label': `${g.title}, ${sys.short}${g.cloud ? ', en tu Google Drive' : ''}`, onclick: twoStep(() => launch(g)) },
          h('div', { class: 'art', vars: { '--ar': 0.75 } }, coverEl(g, sys, { contain: true }), cloudBadge(g)),
          h('div', { class: 'tt' }, isFav(g.id) ? h('span', { class: 'star', 'aria-label': 'Favorito' }, '\u2605') : null, g.title),
          h('div', { class: 'sysname', vars: { '--c': sys.color } }, sys.short));
        t._onFocus = () => { setAccent(sys.color); fillDetail(detail, g, sys, st); };
        grid.append(t);
      }
      const first = list[0];
      fillDetail(detail, first, sysById(first.system), state.status[first.system] || {});
    }

    view().onAction = (a) => {
      if (a === 'lb' || a === 'rb') { setHomeView(false); return true; }
      if (a === 'y') {
        const g = currentGame();
        if (g) toggleFav(g);
        return true;
      }
      if (a === 'x') { if (list.length) openLetters(list); return true; }
      if (a === 'back') { openImport(); return true; }
      return false;
    };
    hints(list.length ? [['a', 'Jugar'], ['y', 'Favorito'], ['x', 'Saltar a letra']] : [['a', 'Elegir']],
      [['lb', 'Ver por consolas', () => setHomeView(false)], ['view', 'Agregar juegos', () => openImport()], ['menu', 'Menú', () => openSettings()]]);
    restoreFocus(list.length ? '.tile' : '.fchip.on, .empty-state .btn');
  }

  function findGame(id) {
    for (const list of [...Object.values(state.library), ...Object.values(state.cloudGames)]) {
      const g = list.find((x) => x.id === id);
      if (g) return g;
    }
    return null;
  }

  // ------------------------------------------------------------------ consola

  function renderSystem(screen, v) {
    const sys = sysById(v.system);
    setAccent(sys.color);
    const list = games(sys.id);
    const st = state.status[sys.id] || {};
    const cell = LANDSCAPE.has(sys.id) ? '13rem' : BOX[sys.id] >= 0.95 ? '10.5rem' : '9.5rem';

    const head = h('header', { class: 'sys-head' },
      h('span', { class: 'switcher' }, glyph('lb')),
      h('h1', {}, sys.name),
      h('span', { class: 'switcher' }, glyph('rb')),
      h('span', { class: 'count' }, list.length === 1 ? '1 juego' : `${list.length} juegos`),
      h('div', { class: 'push' },
        h('button', { class: 'btn ghost small f', 'data-key': 'add', onclick: () => openImport() }, 'Agregar juegos'),
        h('button', { class: 'btn ghost small f', 'data-key': 'cloud', onclick: () => openCloud(sys.id) }, 'Descargar de la nube'),
        h('button', { class: 'btn ghost small f', onclick: () => api.openFolder('roms', sys.id) }, 'Abrir carpeta')));

    const body = h('div', { class: 'sys-body' });
    const root = h('section', { class: 'system' }, head, body);
    screen.append(root);

    if (!list.length) {
      body.style.gridTemplateColumns = '1fr';
      body.append(emptySystem(sys, st));
    } else {
      const detail = h('aside', { class: 'detail' });
      const grid = h('div', { class: 'grid', vars: { '--cell': cell } });
      const wrap = h('div', { class: 'grid-wrap' });
      if (!st.ready) wrap.append(missingNotice(sys, st), h('div', { style: { height: '1.2rem' } }));
      else if (st.bios) wrap.append(biosNotice(sys, st), h('div', { style: { height: '1.2rem' } }));
      else if (st.autoFix) wrap.append(autoNotice(sys, st), h('div', { style: { height: '1.2rem' } }));
      wrap.append(grid);
      body.append(detail, wrap);
      for (const g of list) {
        const t = h('button', { class: `tile f${g.cloud ? ' in-cloud' : ''}`, 'data-key': `game:${g.id}`, 'aria-label': g.cloud ? `${g.title}, en tu Google Drive` : g.title, onclick: twoStep(() => launch(g)) },
          h('div', { class: 'art', vars: { '--ar': BOX[sys.id] || 0.71 } }, coverEl(g, sys, { contain: LANDSCAPE.has(sys.id) }), cloudBadge(g)),
          h('div', { class: 'tt' }, isFav(g.id) ? h('span', { class: 'star', 'aria-label': 'Favorito' }, '\u2605') : null, g.title));
        t._onFocus = () => fillDetail(detail, g, sys, st);
        grid.append(t);
      }
      fillDetail(detail, list[0], sys, st);
    }

    v.onAction = (a) => {
      if (a === 'lb' || a === 'rb') { switchSystem(a === 'lb' ? -1 : 1); return true; }
      if (a === 'y') {
        const g = currentGame();
        if (g) toggleFav(g);
        return true;
      }
      if (a === 'x') { openLetters(); return true; }
      if (a === 'back') { openImport(); return true; }
      return false;
    };
    hints(list.length
      ? [['a', 'Jugar'], ['y', 'Favorito'], ['x', 'Saltar a letra'], ['b', 'Volver']]
      : [['a', 'Elegir'], ['b', 'Volver']],
    [['lb', 'Consola anterior', () => switchSystem(-1)], ['rb', 'Siguiente', () => switchSystem(1)], ['menu', 'Menú', () => openSettings()]]);
    restoreFocus(list.length ? '.tile' : '.notice .btn, .empty-state .btn');
  }

  function currentGame() {
    const el = state.focusEl;
    if (el && el.dataset.key && el.dataset.key.startsWith('game:')) return findGame(el.dataset.key.slice(5));
    const key = state.focusKey[viewId()];
    if (key && key.startsWith('game:')) return findGame(key.slice(5));
    // Si el foco esta en un boton (por ejemplo "Instalar"), se usa el juego que muestra el panel.
    if (!state.detailGame) return null;
    return view().name === 'home' || state.detailGame.system === view().system ? state.detailGame : null;
  }

  function cloudBadge(g) {
    if (!g.cloud) return null;
    const job = inQueue(g.id);
    const pct = job && job.total ? Math.min(99, Math.round((job.bytes / job.total) * 100)) : null;
    return h('span', { class: 'cloud-badge', 'data-cloud': g.id }, job ? (pct != null && job.state === 'descargando' ? `${pct}%` : 'En fila') : '\u2601');
  }

  function fillDetail(detail, g, sys, st) {
    state.detailGame = g;
    if (g.cloud) {
      detail.replaceChildren(
        h('div', { class: 'big', style: { aspectRatio: String(BOX[sys.id] || 0.71) } }, coverEl(g, sys, { contain: LANDSCAPE.has(sys.id) })),
        h('h2', {}, g.title),
        h('div', { class: 'facts' },
          h('span', { class: 'chip cloud' }, '\u2601 En tu Google Drive'),
          fmtSize(g.size) ? h('span', { class: 'chip' }, fmtSize(g.size)) : null,
          g.extras ? h('span', { class: 'chip' }, g.extras === 1 ? 'Con 1 update o DLC' : `Con ${g.extras} updates o DLC`) : null),
        h('p', { class: 'cloud-note' }, 'Presiona A: se descarga y se abre solo al terminar. Después queda en tu Ally para jugar sin internet.'));
      return;
    }
    const play = state.userData.playtime[g.id];
    const last = state.userData.lastPlayed[g.id];
    detail.replaceChildren(
      h('div', { class: 'big', style: { aspectRatio: String(BOX[sys.id] || 0.71) } }, coverEl(g, sys, { contain: LANDSCAPE.has(sys.id) })),
      h('h2', {}, g.title),
      h('div', { class: 'facts' },
        g.disc ? h('span', { class: 'chip' }, `Disco ${g.disc}`) : null,
        g.region ? h('span', { class: 'chip' }, g.region) : null,
        fmtSize(g.size) ? h('span', { class: 'chip' }, fmtSize(g.size)) : null,
        fmtPlay(play) ? h('span', { class: 'chip' }, fmtPlay(play)) : null,
        last ? h('span', { class: 'chip' }, fmtAgo(last)) : null,
        isFav(g.id) ? h('span', { class: 'chip' }, '\u2605 Favorito') : null,
        st.ready ? h('span', { class: 'chip ok' }, st.label.split(' · ')[0]) : h('span', { class: 'chip warn' }, 'Falta emulador')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn small ghost', tabindex: '-1', onclick: () => toggleFav(g) }, isFav(g.id) ? 'Quitar de favoritos' : 'Marcar favorito'),
        h('button', { class: 'btn small ghost', tabindex: '-1', onclick: () => api.reveal(g.id) }, 'Ver archivo')));
  }

  function emptySystem(sys, st) {
    const fmts = sys.folderGames
      ? `Carpetas de juego${sys.ext.length ? ` o ${sys.ext.join(', ')}` : ''}`
      : sys.ext.join(', ');
    return h('div', { class: 'empty-state' },
      h('h2', {}, `Aún no hay juegos de ${sys.short}`),
      h('p', {}, 'Arrastra tus archivos a esta ventana o elige una carpeta. CanacaLabArcadia revisa cada archivo y lo acomoda en su consola.'),
      h('p', {}, 'Formatos: ', h('span', { class: 'fmt' }, fmts)),
      sys.requires ? h('p', {}, sys.requires) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary f', 'data-key': 'empty-add', onclick: () => openImport() }, 'Agregar juegos'),
        h('button', { class: 'btn f', onclick: () => openCloud(sys.id) }, 'Descargar de Google Drive'),
        h('button', { class: 'btn f', onclick: () => api.openFolder('roms', sys.id) }, 'Abrir carpeta de la consola')),
      !st.ready ? missingNotice(sys, st) : st.bios ? biosNotice(sys, st) : st.autoFix ? autoNotice(sys, st) : null);
  }

  // Algo que falta pero que CanacaLabArcadia resuelve sola al jugar (firmware de PS3, disco duro de Xbox).
  function autoNotice(sys, st) {
    return h('div', { class: 'notice' },
      h('h3', {}, 'Todo listo para jugar'),
      h('p', {}, st.autoFix),
      st.firmware ? h('div', { class: 'actions' }, h('button', { class: 'btn f', onclick: installFirmware }, 'Instalarlo ahora')) : null);
  }

  function missingNotice(sys, st) {
    const emuId = st.emu;
    const def = state.catalog.emulators[emuId] || {};
    const manual = ['ryujinx'].includes(emuId);
    const busy = state.installing[emuId] || (state.auto && state.auto.busy && state.auto.label && state.auto.label.includes(def.name || '\u0000'));
    return h('div', { class: `notice${manual ? ' warn' : ''}` },
      h('h3', {}, manual ? (st.reason || `Falta ${def.name}`) : busy ? `Instalando ${def.name}...` : `${def.name} se instala solo`),
      h('p', {}, manual
        ? `${def.name} se descarga a mano desde su sitio oficial. Descomprímelo en la carpeta de emuladores y CanacaLabArcadia lo encontrará.`
        : `Se instala solo desde su sitio oficial al abrir tu primer juego de ${sys.short}. Si quieres, instálalo ya.`),
      h('div', { class: 'actions' },
        manual
          ? h('button', { class: 'btn primary f', onclick: () => api.emuHomepage(emuId) }, `Abrir sitio de ${def.name}`)
          : h('button', { class: 'btn primary f', onclick: () => installEmu(emuId, { thenRender: true }) }, `Instalar ${def.name}`),
        h('button', { class: 'btn f', onclick: () => openSettings('emuladores') }, 'Ver emuladores')));
  }

  function biosNotice(sys, st) {
    const file = ((sys.bios || [])[0] || {}).file || 'BIOS';
    const actions = st.firmware
      ? [
        h('button', { class: `btn ${st.firmwarePup ? 'primary ' : ''}f`, onclick: installFirmware }, 'Instalar firmware'),
        h('button', { class: `btn ${st.firmwarePup ? '' : 'primary '}f`, onclick: () => api.emuFirmwarePage() }, 'Página de Sony'),
        h('button', { class: 'btn f', onclick: () => openCloud('bios') }, 'Descargar de la nube')
      ]
      : [
        h('button', { class: 'btn primary f', onclick: () => openCloud('bios') }, 'Descargar BIOS de la nube'),
        h('button', { class: 'btn f', onclick: () => api.openFolder('roms', sys.id) }, 'Abrir carpeta de juegos')
      ];
    return h('div', { class: 'notice warn' },
      h('h3', {}, `${st.bios}: tus juegos de ${sys.short} no van a abrir`),
      h('p', {}, st.biosHelp || `Sube tu ${file} a la carpeta BIOS de tu Google Drive y descárgalo aquí, o cópialo en la carpeta de juegos de ${sys.short}. CanacaLabArcadia lo deja donde lo busca el emulador.`),
      h('div', { class: 'actions' }, ...actions));
  }

  // Firmware de PS3: RPCS3 se abre, lo instala y al cerrarlo CanacaLabArcadia vuelve y revisa.
  async function installFirmware() {
    toast('Instalando el firmware de PS3. RPCS3 se abre y se cierra solo; tarda 1 a 3 minutos.');
    try {
      const r = await call(api.emuInstallFirmware);
      state.auto = null;
      paintAuto();
      if (r.status) state.status = r.status;
      render();
      toast(r.installed ? 'Firmware de PS3 instalado. Ya puedes jugar PS3.' : 'El firmware no quedó instalado. Intenta de nuevo.', !r.installed);
    } catch (e) {
      state.auto = null;
      paintAuto();
      toast(e.message, true);
    }
  }

  function switchSystem(delta) {
    const list = systemsToShow();
    const i = list.findIndex((s) => s.id === view().system);
    const next = list[(i + delta + list.length) % list.length];
    blip('move');
    state.stack[state.stack.length - 1] = { name: 'system', system: next.id };
    render();
  }

  async function toggleFav(g) {
    if (g.cloud) { toast('Primero descárgalo (A) y luego márcalo como favorito.'); return; }
    try {
      const r = await call(api.favorite, g.id);
      state.userData = r.userData;
      const key = `game:${g.id}`;
      render();
      const el = $(`[data-key="${CSS.escape(key)}"]`);
      if (el) setFocus(el, { silent: true });
      toast(r.favorite ? `${g.title} está en favoritos` : `${g.title} salió de favoritos`);
    } catch (e) {
      toast(e.message, true);
    }
  }

  function openLetters(list = games(view().system)) {
    const letters = [...new Set(list.map((g) => initial(g.title)))];
    const el = h('div', { class: 'sheet', style: { width: 'min(52rem, 92vw)' } },
      h('div', {}, h('h2', {}, 'Saltar a letra')),
      h('div', { class: 'letters' }, letters.map((L) => h('button', { class: 'btn f', onclick: () => { closeLayer(); jumpToLetter(L, list); } }, L))),
      h('div', { class: 'foot' }, h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar')));
    openLayer({ el });
  }

  function initial(t) {
    const c = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|el|la|los|las)\s+/i, '').charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  function jumpToLetter(L, list = view().name === 'home' ? (state.gamesList || []) : games(view().system)) {
    const g = list.find((x) => initial(x.title) === L) || list.find((x) => initial(x.title) > L);
    if (!g) return;
    const el = $(`[data-key="game:${CSS.escape(g.id)}"]`);
    if (el) setFocus(el);
  }

  // ------------------------------------------------------------------ jugar

  // Pantalla de "preparando": instala emulador, baja BIOS, firmware, etc. y luego abre el juego.
  function openPrep(g, sys, { phase = 'Preparando...', cloudJob = null } = {}) {
    if (state.prep) closePrep();
    const phaseEl = h('div', { class: 'e' }, phase);
    const bar = h('div', { class: 'bar indet' }, h('i'));
    const el = h('div', { class: 'launching prep' },
      h('div', { class: 't' }, g.title),
      phaseEl,
      h('div', { class: 'prep-bar' }, bar),
      h('div', { class: 'exit' }, glyph('b'), cloudJob ? 'Seguir navegando (la descarga sigue)' : 'Cancelar'));
    const prep = {
      id: g.id, cloudJob, el,
      update(text, pct) {
        if (text) phaseEl.textContent = text;
        bar.classList.toggle('indet', pct == null);
        bar.firstChild.style.width = `${pct || 0}%`;
      }
    };
    state.prep = prep;
    openLayer({
      cancelable: false,
      el,
      onAction: (a) => {
        if (a === 'b') {
          if (!cloudJob) api.cancelLaunch(g.id);
          closePrep();
          if (cloudJob) toast(`${g.title} sigue bajando. Te aviso cuando esté listo.`);
          return true;
        }
        return true;
      }
    });
    setAccent(sys.color);
    return prep;
  }

  function closePrep() {
    const prep = state.prep;
    if (!prep) return;
    state.prep = null;
    const i = state.layers.findIndex((l) => l.el === prep.el);
    if (i >= 0 && i === state.layers.length - 1) closeLayer();
    else if (i >= 0) state.layers.splice(i, 1);
  }

  async function playCloud(g) {
    const sys = sysById(g.system);
    const prep = openPrep(g, sys, { phase: 'Preparando la descarga desde tu Google Drive...', cloudJob: g.id });
    try {
      const r = await call(api.cloudPlay, g.id);
      prep.cloudJob = r.id;
      paintPrepFromQueue();
    } catch (e) {
      closePrep();
      blip('err');
      toast(e.message, true);
    }
  }

  function paintPrepFromQueue() {
    const prep = state.prep;
    if (!prep || !prep.cloudJob) return;
    const job = inQueue(prep.cloudJob);
    if (!job) return;
    if (job.state === 'descomprimiendo') return prep.update('Descomprimiendo...', null);
    if (job.state === 'descargando') {
      const pct = job.total ? Math.min(99, Math.round((job.bytes / job.total) * 100)) : null;
      const parts = [`Descargando de tu Google Drive${pct != null ? ` · ${pct}%` : ''}`];
      if (fmtSize(job.total)) parts.push(`${fmtSize(job.bytes) || '0 MB'} de ${fmtSize(job.total)}`);
      if (fmtSpeed(job.speed)) parts.push(fmtSpeed(job.speed));
      if (job.eta) parts.push(`faltan ${fmtDuration(job.eta)}`);
      return prep.update(parts.join(' · '), pct);
    }
    const q = state.cloud.queue || {};
    return prep.update(q.current ? `En espera: primero termina ${q.current.name}` : 'En espera...', null);
  }

  async function launch(g) {
    if (state.playing) return;
    if (g.cloud) return playCloud(g);
    const sys = sysById(g.system);
    const prep = openPrep(g, sys, { phase: 'Preparando...' });
    try {
      const r = await call(api.launch, g.id);
      if (state.prep === prep) closePrep();
      else if (!state.layers.length) { /* lo cancelaste: el juego igual abrio */ }
      state.playing = g.id;
      const exitHint = state.comboAvailable
        ? h('div', { class: 'exit' }, 'Para salir del juego mantén', glyph('view'), '+', glyph('menu'))
        : h('div', { class: 'exit' }, 'Para salir del juego cierra el emulador');
      openLayer({
        cancelable: false,
        el: h('div', { class: 'launching' },
          h('div', { class: 't' }, g.title),
          h('div', { class: 'e' }, `Abriendo con ${r.emulator.split(' · ')[0]}`),
          exitHint),
        onAction: (a) => {
          if (a === 'b') { api.stop(); return true; }
          return true;
        }
      });
      setAccent(sys.color);
    } catch (e) {
      if (state.prep === prep) closePrep();
      if (e.code === 'CANCELLED') return;
      blip('err');
      if (e.code === 'NO_EMULATOR') {
        const el = h('div', { class: 'sheet' },
          h('div', {}, h('h2', {}, `No se puede abrir ${g.title}`), h('p', { class: 'sub' }, e.message)),
          h('div', {}),
          h('div', { class: 'foot' },
            h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cerrar'),
            h('span', { class: 'push' }),
            h('button', { class: 'btn primary f', 'data-key': 'fix', onclick: () => { closeLayer(); openSettings('emuladores'); } }, 'Ir a emuladores')));
        openLayer({ el, focus: '[data-key="fix"]' });
      } else if (e.code === 'NO_BIOS') {
        const el = h('div', { class: 'sheet' },
          h('div', {}, h('h2', {}, `Faltan archivos de ${sys.name}`), h('p', { class: 'sub' }, e.message)),
          h('div', {}),
          h('div', { class: 'foot' },
            h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cerrar'),
            h('button', { class: 'btn ghost f', onclick: () => api.openFolder('roms', sys.id) }, 'Abrir carpeta de juegos'),
            h('span', { class: 'push' }),
            sys.id === 'ps3'
              ? h('button', { class: 'btn primary f', 'data-key': 'fix', onclick: () => { closeLayer(); installFirmware(); } }, 'Instalar firmware')
              : h('button', { class: 'btn primary f', 'data-key': 'fix', onclick: () => { closeLayer(); openCloud('bios'); } }, 'Descargar BIOS de la nube')));
        openLayer({ el, focus: '[data-key="fix"]' });
      } else {
        toast(e.message, true);
      }
    }
  }

  // Aviso arriba de la pantalla principal cuando falta conectar Google (lo unico que no puede hacer sola).
  function cloudStrip() {
    const ci = state.cloudInfo || {};
    if (!ci.hasFolders) {
      return h('div', { class: 'cloud-strip' },
        h('span', { class: 'ic' }, '\u2601'),
        h('div', {}, h('strong', {}, 'Tus juegos de Google Drive'),
          h('span', {}, 'Pega el enlace de tu carpeta de ROMs: los juegos aparecen aquí y se bajan solos al jugarlos.')),
        h('button', { class: 'btn primary small f', 'data-key': 'strip-folder', onclick: addFirstFolder }, 'Agregar carpeta'));
    }
    if (ci.connected) return null;
    return h('div', { class: 'cloud-strip' },
      h('span', { class: 'ic' }, '\u2601'),
      h('div', {}, h('strong', {}, 'Conecta tu cuenta de Google'),
        h('span', {}, 'Todos los juegos de tu Drive aparecen aquí y se bajan solos al jugarlos.')),
      h('button', { class: 'btn primary small f', 'data-key': 'strip-connect', onclick: () => connectGoogle() }, 'Conectar Google'));
  }

  async function addFirstFolder() {
    try {
      editSource(await call(api.cloudStatus), null);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------------ capas (hojas encima de la pantalla)

  function openLayer(layer) {
    const host = $('#layer');
    state.layers.push(layer);
    host.replaceChildren(layer.el);
    state.focusEl = null;
    const target = (layer.focus && layer.el.querySelector(layer.focus)) || focusables(layer.el)[0];
    if (target) setFocus(target, { silent: true });
  }

  function closeLayer() {
    const layer = state.layers.pop();
    if (layer && layer.onClose) layer.onClose();
    const host = $('#layer');
    const top = state.layers[state.layers.length - 1];
    host.replaceChildren(...(top ? [top.el] : []));
    state.focusEl = null;
    if (top) {
      const t = focusables(top.el)[0];
      if (t) setFocus(t, { silent: true });
    } else {
      restoreFocus();
    }
  }

  function toast(msg, err = false) {
    const t = h('div', { class: `toast${err ? ' err' : ''}`, role: err ? 'alert' : 'status' }, msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), err ? 7000 : 4200);
  }

  // ------------------------------------------------------------------ agregar juegos

  async function openImport(mode) {
    if (!mode) {
      const el = h('div', { class: 'sheet', style: { width: 'min(46rem, 92vw)' } },
        h('div', {}, h('h2', {}, 'Agregar juegos'),
          h('p', { class: 'sub' }, 'También puedes arrastrar archivos o carpetas a esta ventana. CanacaLabArcadia detecta la consola de cada uno.')),
        h('div', { class: 'rows' },
          h('button', { class: 'btn f', 'data-key': 'pick-folder', onclick: () => { closeLayer(); openImport('folder'); } }, 'Elegir una carpeta o una USB completa'),
          h('button', { class: 'btn f', onclick: () => { closeLayer(); openImport('files'); } }, 'Elegir archivos sueltos'),
          h('button', { class: 'btn f', onclick: () => { closeLayer(); openCloud(); } }, 'Descargar de Google Drive')),
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar')));
      openLayer({ el, focus: '[data-key="pick-folder"]' });
      return;
    }
    try {
      const plan = await call(api.importPick, mode);
      if (plan && plan.length) reviewImport(plan);
      else if (plan) toast('No encontré juegos en lo que elegiste.');
    } catch (e) {
      toast(e.message, true);
    }
  }

  function reviewImport(plan) {
    const items = plan.map((p) => ({ ...p }));
    let move = false;
    const listEl = h('div', { class: 'list' });
    const countBtn = h('button', { class: 'btn primary f', 'data-key': 'go' });
    const moveBtn = h('button', { class: 'toggle f', style: { padding: '0.6rem 1rem' } }, h('span', {}, 'Mover en vez de copiar'), h('span', { class: 'sw' }));

    const draw = () => {
      listEl.replaceChildren(...items.map((it) => {
        const sys = it.system && sysById(it.system);
        const low = !it.system || it.confidence === 'baja';
        const reason = it.needsXiso
          ? `${it.reason}. Conviértelo a XISO con extract-xiso antes de jugar.`
          : (it.companions && it.companions.length ? `${it.reason}. Incluye ${it.companions.length} archivo(s) acompañante(s).` : it.reason);
        // Si el usuario ya eligio, se conservan las opciones para que pueda cambiar de idea.
        const opts = it.candidates && it.confidence !== 'alta' ? it.candidates : null;
        return h('div', { class: `imp${low ? ' low' : ''}` },
          h('div', { class: 'n' }, it.name),
          h('div', { class: 'r' }, reason),
          h('div', { class: 'pick' },
            opts
              ? [...opts.map((id) => h('button', { class: `btn small f${it.system === id ? ' sel' : ''}`, 'data-key': `imp:${it.index}:${id}`, vars: { '--acento': sysById(id).color }, onclick: () => { it.system = id; it.confidence = 'media'; redraw(it); } }, sysById(id).short)),
                h('button', { class: 'btn small ghost f', 'data-key': `imp:${it.index}:otra`, onclick: () => chooseSystemFor(it) }, 'Otra')]
              : h('button', { class: `btn small f${sys ? ' sel' : ''}`, 'data-key': `imp:${it.index}:pick`, onclick: () => chooseSystemFor(it), vars: sys ? { '--acento': sys.color } : {} }, sys ? sys.short : 'Elegir consola')));
      }));
      const n = items.filter((i) => i.system).length;
      countBtn.textContent = n === 1 ? 'Agregar 1 juego' : `Agregar ${n} juegos`;
      countBtn.disabled = n === 0;
    };
    // Redibuja la lista sin perder el lugar donde estaba el foco.
    const redraw = (it) => {
      draw();
      const target = listEl.querySelector(`[data-key="imp:${it.index}:${it.system}"]`) || listEl.querySelector(`[data-key^="imp:${it.index}:"]`);
      if (target) setFocus(target, { silent: true });
    };
    const chooseSystemFor = (it) => {
      const el = h('div', { class: 'sheet', style: { width: 'min(56rem, 92vw)' } },
        h('div', {}, h('h2', {}, it.name), h('p', { class: 'sub' }, 'Elige la consola de este juego')),
        h('div', { class: 'letters' }, state.catalog.systems.map((s) => h('button', {
          class: 'btn f', vars: { '--acento': s.color },
          onclick: () => {
            it.system = s.id;
            it.confidence = 'media';
            if (it.candidates && !it.candidates.includes(s.id)) it.candidates = [...it.candidates, s.id];
            closeLayer();
            redraw(it);
          }
        }, s.short))),
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar')));
      openLayer({ el });
    };

    moveBtn.addEventListener('click', () => {
      move = !move;
      moveBtn.classList.toggle('on', move);
    });
    countBtn.addEventListener('click', () => runImport(items, move));

    const unknown = items.filter((i) => !i.system).length;
    const el = h('div', { class: 'sheet' },
      h('div', {},
        h('h2', {}, items.length === 1 ? '1 juego encontrado' : `${items.length} juegos encontrados`),
        h('p', { class: 'sub' }, unknown
          ? `${unknown === 1 ? '1 no se pudo identificar' : `${unknown} no se pudieron identificar`}: elige su consola (marca amarilla). Los que se queden sin consola no se agregan.`
          : 'Revisa la consola detectada. Puedes cambiarla tocando el botón de cada juego.')),
      listEl,
      h('div', { class: 'foot' },
        moveBtn,
        h('span', { class: 'push' }),
        h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar'),
        countBtn));
    draw();
    openLayer({ el, focus: '[data-key="go"]' });
  }

  async function runImport(items, move) {
    const bar = h('div', { class: 'bar' }, h('i'));
    const label = h('p', { class: 'sub' }, 'Copiando...');
    const el = h('div', { class: 'sheet', style: { gridTemplateRows: 'auto auto' } },
      h('div', {}, h('h2', {}, move ? 'Moviendo juegos' : 'Copiando juegos'), label), bar);
    closeLayer();
    openLayer({ el, cancelable: false });
    const off = api.on('import:progress', (p) => {
      bar.firstChild.style.width = `${p.pct || 0}%`;
      label.textContent = `${p.pct || 0}%`;
    });
    try {
      const r = await call(api.importRun, items.filter((i) => i.system), move);
      state.library = r.library;
      state.status = r.status;
      const { added, skipped, failed } = r.report;
      closeLayer();
      render();
      toast(`${added.length} agregado(s)${skipped.length ? `, ${skipped.length} ya estaban` : ''}${failed.length ? `, ${failed.length} con error` : ''}.`, failed.length > 0);
      if (failed.length) toast(failed[0].error, true);
    } catch (e) {
      closeLayer();
      toast(e.message, true);
    } finally {
      off && off();
    }
  }

  // Arrastrar y soltar desde el Explorador de Windows.
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (!state.settings || !state.settings.dataRoot) return;
    const paths = [...(e.dataTransfer.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try {
      const plan = await call(api.importPlan, paths);
      if (plan.length) reviewImport(plan);
      else toast('No reconocí juegos en lo que soltaste.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ------------------------------------------------------------------ ajustes

  const TABS = [
    ['emuladores', 'Emuladores'],
    ['agregar', 'Agregar juegos'],
    ['nube', 'Nube (Google Drive)'],
    ['controles', 'Controles'],
    ['streaming', 'Streaming al iPad'],
    ['biblioteca', 'Biblioteca'],
    ['preferencias', 'Preferencias'],
    ['salir', 'Salir']
  ];

  function renderSettings(screen, v) {
    setAccent('#6c8cff');
    const pane = h('div', { class: 'pane' });
    const tabs = h('nav', { class: 'tabs' }, h('h1', {}, 'Menú'),
      TABS.map(([id, label]) => h('button', {
        class: `tab f${v.tab === id ? ' on' : ''}`, 'data-key': `tab:${id}`,
        onclick: () => { state.stack[state.stack.length - 1] = { ...v, tab: id }; render(); }
      }, label)));
    screen.append(h('section', { class: 'settings' }, tabs, pane));
    ({ emuladores: paneEmus, agregar: paneImport, nube: paneNube, controles: paneControls, streaming: paneStreaming, biblioteca: paneLibrary, preferencias: panePrefs, salir: paneQuit })[v.tab](pane, v);
    v.onAction = (a) => {
      if (a === 'lb' || a === 'rb') {
        const i = TABS.findIndex(([id]) => id === v.tab);
        const next = TABS[(i + (a === 'lb' ? -1 : 1) + TABS.length) % TABS.length][0];
        state.stack[state.stack.length - 1] = { ...v, tab: next };
        render();
        return true;
      }
      if (a === 'start') { back(); return true; }
      return false;
    };
    hints([['a', 'Elegir'], ['b', 'Volver']], [['lb', 'Sección anterior'], ['rb', 'Siguiente']]);
    restoreFocus(`[data-key="tab:${v.tab}"]`);
  }

  async function loadEmuStatus() {
    state.emu = await call(api.emuStatus);
    return state.emu;
  }

  async function paneEmus(pane, v) {
    pane.append(
      h('h2', {}, 'Emuladores'),
      h('p', { class: 'lead' }, 'No tienes que hacer nada aquí: CanacaLabArcadia instala sola, desde su sitio oficial, el emulador de cada consola donde tengas juegos (en la Ally o en tu Drive) y lo deja configurado para tu control. Aquí puedes instalarlos ya o abrirlos para revisar algo.'));
    const allBtn = h('button', { class: 'btn primary f', 'data-key': 'install-all' }, 'Instalar todos los automáticos');
    pane.append(h('div', { class: 'actions', style: { marginBottom: '1.2rem' } }, allBtn));
    const rows = h('div', { class: 'rows' }, h('p', { class: 'lead' }, 'Revisando emuladores...'));
    pane.append(rows);
    let st;
    try {
      st = await loadEmuStatus();
    } catch (e) {
      rows.replaceChildren(h('p', { class: 'lead' }, e.message));
      return;
    }
    const pending = Object.values(st).filter((e) => e.auto && !e.installed);
    allBtn.disabled = pending.length === 0;
    if (!pending.length) allBtn.textContent = 'Todos los automáticos están instalados';
    allBtn.addEventListener('click', async () => {
      for (const e of pending) await installEmu(e.id);
      if (view().name === 'settings') render();
    });

    rows.replaceChildren(...Object.values(st).map((e) => emuRow(e)));
    if (view() === v && !state.layers.length) restoreFocus('[data-key="install-all"]');
  }

  function emuRow(e) {
    const prog = state.installing[e.id];
    const actions = [];
    if (!e.installed) {
      if (e.auto) actions.push(h('button', { class: 'btn primary small f', disabled: !!prog, onclick: () => installEmu(e.id, { thenRender: true }) }, prog ? 'Instalando...' : 'Instalar'));
      else actions.push(h('button', { class: 'btn primary small f', onclick: () => api.emuHomepage(e.id) }, 'Abrir sitio oficial'));
      actions.push(h('button', { class: 'btn small f', onclick: () => locateEmu(e.id) }, 'Ya lo tengo: ubicar .exe'));
    } else {
      actions.push(h('button', { class: 'btn small f', onclick: () => api.emuOpen(e.id) }, 'Abrir para configurar'));
      actions.push(h('button', { class: 'btn small ghost f', onclick: () => api.openFolder('emulators', e.id) }, 'Carpeta'));
    }
    const notes = [];
    if (e.warning && !e.installed) notes.push(h('p', { class: 'note warn' }, e.warning));
    if (e.setup) notes.push(h('p', { class: 'note' }, `Primera vez: ${e.setup}`));
    if (e.cores) {
      const missing = e.cores.filter((c) => !c.installed).map((c) => c.core);
      if (missing.length) notes.push(h('p', { class: 'note warn' }, `Núcleos que faltan: ${missing.join(', ')}. Se bajan solos al abrir un juego de esa consola.`));
    }
    if (!e.auto && !e.installed) notes.push(h('p', { class: 'note' }, 'Descomprime el .zip dentro de: ', h('span', { class: 'path' }, e.folder)));
    const bar = prog ? h('div', { class: `bar${prog.pct == null ? ' indet' : ''}` }, h('i', { style: { width: `${prog.pct || 0}%` } })) : null;
    return h('div', { class: 'row', 'data-emu': e.id },
      h('div', { class: 'who' },
        h('strong', {}, e.name, '  ', e.installed ? h('span', { class: 'chip ok' }, 'Instalado') : h('span', { class: 'chip warn' }, e.auto ? 'No instalado' : 'Manual')),
        h('span', {}, `${e.desc} Para: ${e.systems.join(', ')}.`),
        prog ? h('span', {}, prog.phase || '') : null),
      h('div', { class: 'act' }, actions),
      bar, notes);
  }

  async function installEmu(id, { thenRender = false } = {}) {
    if (state.installing[id]) return;
    state.installing[id] = { phase: 'Preparando...', pct: null };
    refreshEmuRow(id);
    try {
      const r = await call(api.emuInstall, id);
      state.status = r.status;
      delete state.installing[id];
      const name = state.catalog.emulators[id].name;
      toast(r.failedCores && r.failedCores.length
        ? `${name} instalado. No se pudieron bajar: ${r.failedCores.join(', ')}.`
        : `${name} instalado y listo.`);
    } catch (e) {
      delete state.installing[id];
      toast(`${state.catalog.emulators[id].name}: ${e.message}`, true);
    }
    if (thenRender || view().name === 'settings') render();
  }

  function refreshEmuRow(id) {
    const row = $(`.row[data-emu="${id}"]`);
    if (!row || !state.emu || !state.emu[id]) return;
    const hadFocus = row.contains(state.focusEl);
    const fresh = emuRow(state.emu[id]);
    row.replaceWith(fresh);
    if (hadFocus) {
      const f = focusables(fresh)[0];
      if (f) setFocus(f, { silent: true, scroll: false });
    }
  }

  async function locateEmu(id) {
    try {
      const r = await call(api.emuLocate, id);
      if (r) {
        state.status = r.status;
        toast(`${state.catalog.emulators[id].name} encontrado.`);
        render();
      }
    } catch (e) {
      toast(e.message, true);
    }
  }

  function paneImport(pane) {
    pane.append(
      h('h2', {}, 'Agregar juegos'),
      h('p', { class: 'lead' }, 'Elige una carpeta (por ejemplo tu USB o tu carpeta de respaldos) y CanacaLabArcadia revisa cada archivo: lee la cabecera de los discos para saber si un .iso es de PS2, PSP, GameCube, Wii, Xbox o Xbox 360. Solo te pregunta cuando no hay forma de saberlo.'),
      h('div', { class: 'actions', style: { marginBottom: '1.6rem' } },
        h('button', { class: 'btn primary f', 'data-key': 'imp-folder', onclick: () => openImport('folder') }, 'Elegir una carpeta o USB'),
        h('button', { class: 'btn f', onclick: () => openImport('files') }, 'Elegir archivos')),
      h('h3', { class: 'section-title', style: { marginBottom: '0.8rem' } }, 'Formatos por consola'),
      h('div', { class: 'rows' }, state.catalog.systems.map((s) => h('div', { class: 'row' },
        h('div', { class: 'who' }, h('strong', {}, s.name),
          h('span', {}, s.folderGames ? `Carpetas de juego${s.ext.length ? ` o ${s.ext.join(', ')}` : ''}` : s.ext.join(', ')),
          s.requires ? h('span', {}, s.requires) : null),
        h('div', { class: 'act' }, h('button', { class: 'btn small ghost f', onclick: () => api.openFolder('roms', s.id) }, 'Abrir carpeta'))))));
  }

  function paneControls(pane, v) {
    const svg = padSvg();
    pane.append(
      h('h2', {}, 'Controles'),
      h('p', { class: 'lead' }, 'Mueve los sticks y presiona botones: lo que se ilumina es lo que recibe CanacaLabArcadia. El control de la ROG Ally X funciona en todos los emuladores sin configurar nada. Una palanca arcade funciona igual si la pones en modo Xbox (XInput).'),
      h('div', { class: 'tester' },
        svg.el,
        h('div', { class: 'combo-list' },
          h('div', {}, h('span', { class: 'keys' }, glyph('view'), '+', glyph('menu')), h('span', {}, state.comboAvailable
            ? 'Mantener 1 segundo: salir de cualquier juego y volver a CanacaLabArcadia'
            : 'Salir de un juego: cierra el emulador (la salida con control solo funciona en Windows)')),
          h('div', {}, h('span', { class: 'keys' }, h('span', { class: 'glyph wide' }, 'L3'), '+', h('span', { class: 'glyph wide' }, 'R3')), h('span', {}, 'Menú de RetroArch (guardar estado, trucos, controles) en juegos retro y arcade')),
          h('div', {}, h('span', { class: 'keys' }, glyph('lb'), glyph('rb')), h('span', {}, 'Cambiar de consola dentro de la biblioteca')),
          h('div', {}, h('span', { class: 'keys' }, glyph('y')), h('span', {}, 'Marcar favorito')),
          h('div', {}, h('span', { class: 'keys' }, glyph('x')), h('span', {}, 'Saltar a una letra en listas largas')),
          h('p', { class: 'note', id: 'pad-names', style: { color: 'var(--tenue)', margin: '0.4rem 0 0' } }, 'Sin control detectado. Presiona cualquier botón.'))),
      h('h3', { class: 'section-title', style: { margin: '2rem 0 0.8rem' } }, 'Ajustes por emulador'),
      h('div', { class: 'rows' }, Object.entries(state.catalog.emulators).map(([id, e]) => h('div', { class: 'row' },
        h('div', { class: 'who' }, h('strong', {}, e.name), h('span', {}, e.controls || 'Automático.')),
        h('div', { class: 'act' }, h('button', { class: 'btn small ghost f', onclick: () => api.emuOpen(id).then((r) => !r.ok && toast(r.error, true)) }, 'Abrir emulador'))))));
    v.onFrame = (pads) => {
      svg.update(pads[0]);
      const names = $('#pad-names');
      if (names) names.textContent = pads.length ? `Detectado: ${pads.map((p) => p.id.replace(/\(.*?\)/g, '').trim()).join(', ')}` : 'Sin control detectado. Presiona cualquier botón.';
    };
  }

  // Control generico (forma de "dos sticks") dibujado en SVG, sin marcas.
  function padSvg() {
    const NS = 'http://www.w3.org/2000/svg';
    const s = (tag, attrs, text) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val);
      if (text) el.textContent = text;
      return el;
    };
    const svg = s('svg', { viewBox: '0 0 520 320', class: 'pad-svg', role: 'img', 'aria-label': 'Probador de control' });
    svg.append(s('path', { class: 'body', d: 'M110 70 H410 C470 70 505 120 512 190 C520 270 490 310 455 310 C420 310 400 270 380 245 H140 C120 270 100 310 65 310 C30 310 0 270 8 190 C15 120 50 70 110 70 Z' }));
    const btns = {};
    const add = (key, shape, label) => {
      const el = shape;
      el.classList.add('b');
      svg.append(el);
      if (label) svg.append(s('text', { x: shape.getAttribute('cx') || (Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2), y: shape.getAttribute('cy') || (Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2) }, label));
      btns[key] = el;
    };
    add(6, s('rect', { x: 70, y: 10, width: 90, height: 34, rx: 10 }), 'LT');
    add(7, s('rect', { x: 360, y: 10, width: 90, height: 34, rx: 10 }), 'RT');
    add(4, s('rect', { x: 70, y: 50, width: 90, height: 20, rx: 8 }), 'LB');
    add(5, s('rect', { x: 360, y: 50, width: 90, height: 20, rx: 8 }), 'RB');
    add(3, s('circle', { cx: 420, cy: 120, r: 19 }), 'Y');
    add(2, s('circle', { cx: 382, cy: 158, r: 19 }), 'X');
    add(1, s('circle', { cx: 458, cy: 158, r: 19 }), 'B');
    add(0, s('circle', { cx: 420, cy: 196, r: 19 }), 'A');
    add(12, s('rect', { x: 160, y: 182, width: 30, height: 30, rx: 5 }), '');
    add(13, s('rect', { x: 160, y: 242, width: 30, height: 30, rx: 5 }), '');
    add(14, s('rect', { x: 130, y: 212, width: 30, height: 30, rx: 5 }), '');
    add(15, s('rect', { x: 190, y: 212, width: 30, height: 30, rx: 5 }), '');
    add(8, s('rect', { x: 218, y: 120, width: 34, height: 22, rx: 8 }), '');
    add(9, s('rect', { x: 268, y: 120, width: 34, height: 22, rx: 8 }), '');
    const stickL = s('circle', { class: 'stick', cx: 110, cy: 150, r: 34 });
    const stickR = s('circle', { class: 'stick', cx: 330, cy: 225, r: 34 });
    const knobL = s('circle', { class: 'knob', cx: 110, cy: 150, r: 12 });
    const knobR = s('circle', { class: 'knob', cx: 330, cy: 225, r: 12 });
    svg.append(stickL, stickR, knobL, knobR);
    btns[10] = stickL;
    btns[11] = stickR;
    stickL.classList.add('b');
    stickR.classList.add('b');
    return {
      el: svg,
      update(p) {
        for (const [i, el] of Object.entries(btns)) el.classList.toggle('on', !!(p && p.buttons[i] && p.buttons[i].pressed));
        const ax = (i) => (p && p.axes[i]) || 0;
        knobL.setAttribute('cx', 110 + ax(0) * 22);
        knobL.setAttribute('cy', 150 + ax(1) * 22);
        knobR.setAttribute('cx', 330 + ax(2) * 22);
        knobR.setAttribute('cy', 225 + ax(3) * 22);
      }
    };
  }

  function paneStreaming(pane) {
    const exeHint = 'CanacaLabArcadia.exe --kiosk';
    pane.append(
      h('h2', {}, 'Streaming al iPad'),
      h('p', { class: 'lead' }, 'Los juegos corren en la Ally X y el iPad muestra la imagen y manda los botones. Se configura una sola vez.'),
      h('ol', { class: 'steps' },
        h('li', {}, h('div', {}, h('strong', {}, 'Instala Sunshine en la Ally X'),
          h('p', {}, 'Es gratis y de código abierto (LizardByte). Al terminar abre su panel en el navegador y crea tu usuario.'))),
        h('li', {}, h('div', {}, h('strong', {}, 'Agrega CanacaLabArcadia como aplicacion en Sunshine'),
          h('p', {}, 'En Applications > Add New, nombre "CanacaLabArcadia" y comando ', h('span', { class: 'path' }, exeHint),
            '. El modo --kiosk abre CanacaLabArcadia en pantalla completa y sin bordes, ideal para el iPad.'))),
        h('li', {}, h('div', {}, h('strong', {}, 'Instala Moonlight en el iPad'),
          h('p', {}, 'Gratis en el App Store. Con los dos en el mismo Wi-Fi, la Ally X aparece sola: tócala y escribe el PIN en el panel de Sunshine.'))),
        h('li', {}, h('div', {}, h('strong', {}, 'Juega'),
          h('p', {}, 'En Moonlight toca CanacaLabArcadia. Conecta tu control o palanca al iPad por Bluetooth: los botones llegan a la Ally X. Para menos retraso usa Wi-Fi de 5 GHz y la Ally X conectada al cargador.')))),
      h('div', { class: 'notice', style: { marginTop: '1.6rem' } },
        h('h3', {}, 'Consejo para la ROG Ally X'),
        h('p', {}, 'En Armoury Crate pon el modo de rendimiento en Turbo mientras transmites, y en Sunshine usa el codificador de AMD (AMF). La resolución de 1920x1080 a 60 fps se ve bien en el iPad Pro.')),
      h('div', { class: 'actions', style: { marginTop: '1.2rem' } },
        h('button', { class: 'btn f', 'data-key': 'stream-full', onclick: async () => { await api.toggleFullscreen(); } }, 'Probar pantalla completa')));
  }

  function paneLibrary(pane) {
    const s = state.settings;
    const total = Object.values(state.library).reduce((t, l) => t + l.length, 0);
    pane.append(
      h('h2', {}, 'Biblioteca'),
      h('p', { class: 'lead' }, `${total} juegos en la Ally${Object.values(state.cloudGames).reduce((t, l) => t + l.length, 0) ? ` y ${Object.values(state.cloudGames).reduce((t, l) => t + l.length, 0)} más en tu Google Drive` : ''}. Todo vive en esta carpeta: roms, bios, emuladores, partidas guardadas y portadas.`),
      h('div', { class: 'row' },
        h('div', { class: 'who' }, h('strong', {}, 'Carpeta de la biblioteca'), h('span', { class: 'path' }, s.dataRoot || 'Sin elegir')),
        h('div', { class: 'act' },
          h('button', { class: 'btn small f', 'data-key': 'lib-open', onclick: () => api.openFolder('root') }, 'Abrir'),
          h('button', { class: 'btn small ghost f', onclick: () => chooseRoot(null) }, 'Cambiar'))),
      h('div', { class: 'actions', style: { margin: '1.2rem 0 2rem' } },
        h('button', { class: 'btn f', onclick: rescanLibrary }, 'Actualizar biblioteca'),
        h('button', { class: 'btn f', onclick: () => api.openFolder('bios') }, 'Abrir carpeta de BIOS'),
        h('button', { class: 'btn f', onclick: downloadCovers }, 'Buscar portadas ahora')),
      coversSection(),
      h('h3', { class: 'section-title', style: { marginBottom: '0.8rem' } }, 'Carpetas extra por consola'),
      h('p', { class: 'lead', style: { marginBottom: '0.9rem' } }, 'Útil si tienes juegos en la microSD o en un disco externo y no quieres copiarlos.'),
      h('div', { class: 'rows' }, state.catalog.systems.map((sys) => {
        const extra = (s.extraRomDirs && s.extraRomDirs[sys.id]) || [];
        return h('div', { class: 'row' },
          h('div', { class: 'who' }, h('strong', {}, sys.name),
            extra.length ? extra.map((d) => h('span', {}, h('span', { class: 'path' }, d), ' ',
              h('button', { class: 'btn small ghost f', onclick: () => removeDir(sys.id, d) }, 'Quitar'))) : h('span', {}, `Solo roms\\${sys.id}`)),
          h('div', { class: 'act' }, h('button', { class: 'btn small f', onclick: () => addDir(sys.id) }, 'Agregar carpeta')));
      })));
  }

  // ---- portadas inteligentes (IGDB y ScreenScraper)

  const SOURCE_NAMES = { screenscraper: 'ScreenScraper', igdb: 'IGDB', libretro: 'libretro' };

  function coversSection() {
    const status = h('span', {}, 'Revisando...');
    const row = h('div', { class: 'row', style: { marginBottom: '2rem' } },
      h('div', { class: 'who' }, h('strong', {}, 'Portadas inteligentes'),
        h('span', {}, 'Con tu llave de IGDB (Twitch) y/o tu cuenta de ScreenScraper, CanacaLabArcadia reconoce cada juego aunque el archivo tenga un nombre raro y le pone su portada sola.'),
        status),
      h('div', { class: 'act' }, h('button', { class: 'btn small f', 'data-key': 'covers-config', onclick: () => editCoversConfig() }, 'Configurar')));
    call(api.coversConfig).then((c) => {
      state.coversConfig = c;
      status.textContent = `Fuentes activas: ${c.activas.map((x) => SOURCE_NAMES[x]).join(', ')}.`;
    }).catch(() => { status.textContent = ''; });
    return row;
  }

  async function editCoversConfig() {
    let cfg = state.coversConfig;
    try { cfg = await call(api.coversConfig); } catch { /* se usa lo que habia */ }
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'hint-line' }, hint) : null);
    const input = (value, placeholder, type = 'text') => h('input', { class: 'input f', type, value: value || '', placeholder, autocomplete: 'off', spellcheck: 'false' });
    const saved = (has) => (has ? 'Guardada (escribe solo si quieres cambiarla)' : '');
    const igId = input(cfg.igdb.clientId, 'Client ID de tu app en dev.twitch.tv');
    const igSecret = input('', saved(cfg.igdb.clientSecret) || 'Client Secret', 'password');
    const ssUser = input(cfg.screenscraper.usuario, 'Tu usuario de screenscraper.fr');
    const ssPass = input('', saved(cfg.screenscraper.clave) || 'Tu contraseña de screenscraper.fr', 'password');
    const ssDev = input(cfg.screenscraper.devid, 'ID de desarrollador que te da ScreenScraper');
    const ssDevPass = input('', saved(cfg.screenscraper.devclave) || 'Contraseña de desarrollador', 'password');
    const result = h('p', { class: 'sub', role: 'status' });
    const save = async () => {
      result.textContent = 'Guardando y probando...';
      try {
        const r = await call(api.coversSaveConfig, {
          igdb: { clientId: igId.value, clientSecret: igSecret.value },
          screenscraper: { usuario: ssUser.value, clave: ssPass.value, devid: ssDev.value, devclave: ssDevPass.value }
        });
        state.coversConfig = r.config;
        const lines = [];
        if (r.test.igdb) lines.push(`IGDB: ${r.test.igdb === 'ok' ? 'listo' : r.test.igdb}`);
        if (r.test.screenscraper) lines.push(`ScreenScraper: ${r.test.screenscraper.startsWith('ok') ? r.test.screenscraper.replace(/^ok:?\s*/, 'listo. ') : r.test.screenscraper}`);
        const okAll = Object.values(r.test).every((v) => String(v).startsWith('ok'));
        result.textContent = lines.length ? lines.join(' · ') : 'Guardado. Sin llaves, solo se usa libretro.';
        if (okAll && lines.length) {
          toast('Listo: las portadas que faltan se buscan solas en segundo plano.');
          closeLayer();
          render();
        }
      } catch (e) {
        result.textContent = e.message;
      }
    };
    const el = h('div', { class: 'sheet', style: { width: 'min(60rem, 94vw)', maxHeight: '92vh', overflowY: 'auto' } },
      h('div', {}, h('h2', {}, 'Portadas inteligentes'),
        h('p', { class: 'sub' }, 'Las llaves se guardan solo en tu Ally (en la carpeta config de tu biblioteca), no en el instalador que compartes.')),
      h('div', { class: 'form' },
        h('h3', { class: 'section-title' }, 'IGDB (gratis, con tu cuenta de Twitch)'),
        h('p', { class: 'hint-line' }, '1) Entra a dev.twitch.tv/console con tu cuenta de Twitch (pide tener activada la verificación en dos pasos). 2) "Register Your Application": nombre CanacaLabArcadia, OAuth Redirect URL http://localhost, categoría "Application Integration", tipo "Confidential". 3) En "Manage" copia el Client ID y toca "New Secret" para el Client Secret.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn small f', onclick: () => api.coversOpenSite('twitch') }, 'Abrir dev.twitch.tv')),
        field('Client ID', igId),
        field('Client Secret', igSecret),
        h('h3', { class: 'section-title', style: { marginTop: '1rem' } }, 'ScreenScraper (opcional, el más exacto para retro)'),
        h('p', { class: 'hint-line' }, 'Necesita dos cosas: tu cuenta de usuario (gratis) y un ID de desarrollador, que ScreenScraper da a cada programa: se pide una vez en su foro, en la sección de la API, diciendo que es para CanacaLabArcadia (uso personal). Mientras no lo tengas, IGDB y libretro funcionan solos.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small f', onclick: () => api.coversOpenSite('screenscraper') }, 'Crear cuenta'),
          h('button', { class: 'btn small ghost f', onclick: () => api.coversOpenSite('screenscraperForo') }, 'Foro para pedir el ID de desarrollador')),
        field('Usuario', ssUser),
        field('Contraseña', ssPass),
        field('ID de desarrollador', ssDev),
        field('Contraseña de desarrollador', ssDevPass),
        result),
      h('div', { class: 'foot' }, h('span', { class: 'push' }),
        h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cerrar'),
        h('button', { class: 'btn primary f', 'data-key': 'covers-save', onclick: save }, 'Guardar y probar')));
    openLayer({ el, focus: 'input' });
  }

  async function rescanLibrary() {
    try {
      const r = await call(api.scan);
      state.library = r.library;
      state.status = r.status;
      // Tambien se vuelve a leer tu Google Drive (si hay cuenta conectada).
      if (state.cloudInfo && state.cloudInfo.connected) {
        try {
          const c = await call(api.cloudRefresh);
          state.cloudGames = c.games;
          state.cloudInfo = c.info;
        } catch (e) { toast(`Google Drive: ${e.message}`, true); }
      }
      toast('Biblioteca actualizada.');
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function downloadCovers() {
    const label = h('p', { class: 'sub' }, 'Buscando portadas...');
    const el = h('div', { class: 'sheet', style: { gridTemplateRows: 'auto' } }, h('div', {}, h('h2', {}, 'Portadas'), label));
    openLayer({ el, cancelable: false });
    const off = api.on('covers:progress', (p) => { label.textContent = `${p.done} de ${p.total}: ${p.title}`; });
    try {
      const r = await call(api.fetchCovers);
      state.library = r.library;
      if (r.cloudGames) state.cloudGames = r.cloudGames;
      closeLayer();
      const how = r.bySource ? Object.entries(r.bySource).map(([k, n]) => `${n} de ${SOURCE_NAMES[k] || k}`).join(', ') : '';
      const err = r.errors && r.errors.length ? ` (${r.errors[0]})` : '';
      toast(r.total ? `Encontré ${r.found} portadas de ${r.total}${how ? `: ${how}` : ''}. Las demás usan la portada generada.${err}` : 'Todos tus juegos ya tienen portada.', !!err && !r.found);
      render();
    } catch (e) {
      closeLayer();
      toast(e.message, true);
    } finally {
      off && off();
    }
  }

  async function addDir(id) {
    try {
      const r = await call(api.addRomDir, id);
      if (r) Object.assign(state, { settings: r.settings, library: r.library });
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function removeDir(id, d) {
    try {
      const r = await call(api.removeRomDir, id, d);
      Object.assign(state, { settings: r.settings, library: r.library });
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function panePrefs(pane) {
    const toggle = (key, label, desc) => {
      const el = h('button', { class: `toggle f${state.settings[key] ? ' on' : ''}`, 'data-key': `pref:${key}` },
        h('div', { class: 'who', style: { display: 'grid', gap: '0.25rem' } }, h('strong', {}, label), h('span', { style: { color: 'var(--tenue)', fontSize: '0.92rem' } }, desc)),
        h('span', { class: 'sw' }));
      el.addEventListener('click', async () => {
        try {
          state.settings = await call(api.updateSettings, { [key]: !state.settings[key] });
          el.classList.toggle('on', !!state.settings[key]);
        } catch (e) {
          toast(e.message, true);
        }
      });
      return el;
    };
    pane.append(
      h('h2', {}, 'Preferencias'),
      h('div', { class: 'rows', style: { marginTop: '1rem' } },
        toggle('startFullscreen', 'Abrir en pantalla completa', 'Recomendado en la Ally X. F11 cambia el modo en cualquier momento.'),
        toggle('sounds', 'Sonidos de navegación', 'Un clic suave al moverte y al elegir.'),
        toggle('showEmptySystems', 'Mostrar consolas sin juegos', 'Si lo apagas, el estante solo muestra las consolas donde ya tienes juegos.'),
        toggle('homeGames', 'Pantalla principal por juegos', 'Muestra todos tus juegos juntos, con filtros por consola, favoritos y recientes. En la pantalla principal también cambias con LB / RB.'),
        offlineToggle()));
  }

  // Firewall de Windows: los emuladores no pueden conectarse a internet (Windows pide permiso de administrador).
  function offlineToggle() {
    const el = h('button', { class: `toggle f${state.settings.emulatorsOffline ? ' on' : ''}`, 'data-key': 'pref:offline' },
      h('div', { class: 'who', style: { display: 'grid', gap: '0.25rem' } },
        h('strong', {}, 'Emuladores sin internet'),
        h('span', { style: { color: 'var(--tenue)', fontSize: '0.92rem' } }, 'Crea reglas en el Firewall de Windows para que ningún emulador de tu biblioteca se conecte. Vuelve a activarlo si instalas un emulador nuevo.')),
      h('span', { class: 'sw' }));
    el.addEventListener('click', async () => {
      const want = !state.settings.emulatorsOffline;
      try {
        state.settings = await call(api.firewall, want);
        el.classList.toggle('on', !!state.settings.emulatorsOffline);
        toast(want ? 'Listo: los emuladores ya no tienen internet.' : 'Los emuladores vuelven a tener internet.');
      } catch (e) {
        toast(e.message, true);
      }
    });
    return el;
  }

  function paneQuit(pane) {
    pane.append(
      h('h2', {}, 'Salir'),
      h('p', { class: 'lead' }, 'Cierra CanacaLabArcadia. Tus juegos, partidas y ajustes se quedan guardados en la carpeta de la biblioteca.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary f', 'data-key': 'quit', onclick: () => api.quit() }, 'Cerrar CanacaLabArcadia')));
  }

  // ------------------------------------------------------------------ nube (Google Drive)

  state.cloud = { status: null, folders: {}, items: {}, queue: { current: null, pending: [] } };

  async function cloudStatus(force = false) {
    if (state.cloud.status && !force) return state.cloud.status;
    const st = await call(api.cloudStatus);
    state.cloud.status = st;
    if (st.queue) state.cloud.queue = st.queue;
    return st;
  }

  function openCloud(system, source) {
    go({ name: 'cloud', system: system || null, source: source || null });
  }

  const sysLabel = (id) => (id === 'bios' ? 'BIOS' : sysById(id) ? sysById(id).short : null);
  const sysColor = (id) => (id === 'bios' ? '#9aa4b8' : sysById(id) ? sysById(id).color : '#4b5563');

  function fmtSpeed(bps) {
    if (!bps) return null;
    return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`;
  }

  function inQueue(id) {
    const q = state.cloud.queue || {};
    if (q.current && q.current.id === id) return q.current;
    return (q.pending || []).find((j) => j.id === id) || null;
  }

  function itemChip(u) {
    const job = inQueue(u.id);
    if (job && job.state === 'descomprimiendo') return h('span', { class: 'chip' }, 'Descomprimiendo...');
    if (job && job.state === 'descargando') {
      const pct = job.total ? Math.min(99, Math.round((job.bytes / job.total) * 100)) : 0;
      return h('span', { class: 'chip' }, `Descargando ${pct}%`);
    }
    if (job) return h('span', { class: 'chip' }, 'En cola');
    if (u.downloaded) return h('span', { class: 'chip ok' }, 'En tu biblioteca');
    return h('span', { class: 'chip cloud' }, 'Descargar');
  }

  function cloudHead(extra) {
    return h('header', { class: 'sys-head' },
      h('h1', {}, 'Descargar de la nube'),
      extra || null,
      h('div', { class: 'push' },
        h('button', { class: 'btn ghost small f', 'data-key': 'cloud-settings', onclick: () => openSettings('nube') }, 'Cuentas y carpetas')));
  }

  function queueBar() {
    const bar = h('div', { class: 'cloud-queue', id: 'cloud-queue' });
    paintQueue(bar);
    return bar;
  }

  function paintQueue(bar = $('#cloud-queue')) {
    if (!bar) return;
    const q = state.cloud.queue || {};
    const cur = q.current;
    const more = (q.pending || []).length;
    if (!cur && !more) {
      bar.replaceChildren();
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const pct = cur && cur.total ? Math.min(100, Math.round((cur.bytes / cur.total) * 100)) : 0;
    const bits = [
      cur && cur.state === 'descomprimiendo' ? 'Descomprimiendo' : `${pct}%`,
      cur && cur.total ? `${fmtSize(cur.bytes) || '0 KB'} de ${fmtSize(cur.total)}` : null,
      cur && cur.state !== 'descomprimiendo' ? fmtSpeed(cur.speed) : null,
      more ? (more === 1 ? '1 más en cola' : `${more} más en cola`) : null
    ].filter(Boolean);
    bar.replaceChildren(
      h('div', { class: 'cq-text' }, h('strong', {}, cur ? cur.name : 'Preparando descarga...'), h('span', {}, bits.join(', '))),
      h('div', { class: `bar${cur && cur.total ? '' : ' indet'}` }, h('i', { style: { width: `${pct}%` } })),
      h('button', { class: 'btn small ghost', tabindex: '-1', onclick: () => api.cloudCancel(null) }, 'Cancelar todo'));
  }

  function refreshItemChips() {
    document.querySelectorAll('.cloud-item[data-id]').forEach((row) => {
      const key = row.dataset.list;
      const list = state.cloud.items[key];
      const u = list && list.items.find((x) => x.id === row.dataset.id);
      if (!u) return;
      const old = row.querySelector('.chip');
      if (old) old.replaceWith(itemChip(u));
    });
  }

  function cloudEmpty(title, text, ...buttons) {
    return h('div', { class: 'empty-state' }, h('h2', {}, title), text ? h('p', {}, text) : null, buttons.length ? h('div', { class: 'actions' }, buttons) : null);
  }

  async function renderCloud(screen, v) {
    setAccent(v.system && sysById(v.system) ? sysById(v.system).color : '#4f86f7');
    const root = h('section', { class: 'system cloud' });
    screen.append(root);
    hints([['a', 'Elegir'], ['b', 'Volver']], [['menu', 'Menú', () => openSettings('nube')]]);
    root.append(cloudHead(), h('p', { class: 'lead cloud-wait' }, 'Revisando tu conexión con Google Drive...'));

    let st;
    try {
      st = await cloudStatus(true);
    } catch (e) {
      if (view() !== v) return;
      root.replaceChildren(cloudHead(), cloudEmpty('No se pudo leer la configuración de la nube', e.message));
      restoreFocus();
      return;
    }
    if (view() !== v) return;

    if (!st.cuentas.length) {
      root.replaceChildren(cloudHead(), cloudEmpty(
        'Conecta tu cuenta de Google',
        'Tu carpeta de juegos en Google Drive es privada, así que CanacaLabArcadia necesita iniciar sesión con la cuenta donde está (o con una cuenta con la que la compartiste). El permiso es solo de lectura: no puede borrar ni cambiar nada.',
        h('button', { class: 'btn primary f', 'data-key': 'cloud-connect', onclick: connectGoogle }, 'Conectar cuenta de Google')));
      restoreFocus('[data-key="cloud-connect"]');
      return;
    }
    if (!st.carpetas.length) {
      root.replaceChildren(cloudHead(), cloudEmpty('Agrega una carpeta de Google Drive', 'Pega el enlace de la carpeta donde guardas tus juegos.',
        h('button', { class: 'btn primary f', 'data-key': 'cloud-add', onclick: () => editSource(st, null) }, 'Agregar carpeta')));
      restoreFocus('[data-key="cloud-add"]');
      return;
    }

    const sources = st.carpetas;
    if (!v.source || !sources.some((s) => s.id === v.source)) v.source = sources[0].id;
    const src = sources.find((s) => s.id === v.source);
    const srcEl = sources.length > 1
      ? h('span', { class: 'switcher' }, glyph('lb'), h('span', { class: 'count' }, src.nombre), glyph('rb'))
      : h('span', { class: 'count' }, src.nombre);
    const foldersEl = h('nav', { class: 'cloud-folders' }, h('p', { class: 'lead' }, 'Leyendo tu Google Drive...'));
    const itemsEl = h('div', { class: 'cloud-items' });
    root.replaceChildren(cloudHead(srcEl), queueBar(), h('div', { class: 'cloud-body' }, foldersEl, itemsEl));

    v.onAction = (a) => {
      if ((a === 'lb' || a === 'rb') && sources.length > 1) {
        const i = sources.findIndex((s) => s.id === v.source);
        state.stack[state.stack.length - 1] = { name: 'cloud', source: sources[(i + (a === 'lb' ? -1 : 1) + sources.length) % sources.length].id };
        render();
        return true;
      }
      if (a === 'x') { downloadAllPending(v); return true; }
      if (a === 'y') { loadCloudItems(v, itemsEl, true); return true; }
      return false;
    };
    hints([['a', 'Descargar'], ['x', 'Descargar todo'], ['y', 'Actualizar lista'], ['b', 'Volver']],
      [sources.length > 1 ? ['lb', 'Otra carpeta', () => v.onAction('lb')] : null, ['menu', 'Menú', () => openSettings('nube')]].filter(Boolean));

    let folders;
    try {
      const r = await call(api.cloudFolders, src.id);
      folders = r.folders;
      state.cloud.folders[src.id] = folders;
    } catch (e) {
      if (view() !== v) return;
      foldersEl.replaceChildren(h('div', { class: 'notice warn' }, h('h3', {}, 'No pude abrir la carpeta'),
        h('p', {}, e.message),
        h('p', {}, 'Revisa que la cuenta conectada sea la dueña de la carpeta o que la carpeta esté compartida con ella.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn f', onclick: () => openSettings('nube') }, 'Revisar cuentas y carpetas'))));
      restoreFocus();
      return;
    }
    if (view() !== v) return;
    if (!folders.length) {
      foldersEl.replaceChildren(h('p', { class: 'lead' }, 'La carpeta no tiene subcarpetas. Crea una por consola (PS2, Nintendo 64, Xbox 360...) y pon ahí tus juegos.'));
      return;
    }
    const usable = folders.filter((f) => f.supported);
    if (!v.folder || !folders.some((f) => f.name === v.folder)) {
      const pick = (v.system && usable.find((f) => f.system === v.system)) || usable[0] || folders[0];
      v.folder = pick.name;
    }
    foldersEl.replaceChildren(...folders.map((f) => {
      const label = f.supported ? sysLabel(f.system) : f.system === null ? 'Sin consola' : 'No compatible';
      const btn = h('button', {
        class: `cloud-folder f${f.name === v.folder ? ' on' : ''}${f.supported ? '' : ' off'}`,
        'data-key': `cf:${f.name}`, vars: { '--c': sysColor(f.system) },
        onclick: () => {
          if (!f.supported) { chooseFolderSystem(f, v); return; }
          if (v.folder !== f.name) select();
          // Con A sobre una carpeta ya abierta se salta a su primer juego.
          const first = itemsEl.querySelector('.cloud-item');
          if (first && v.folder === f.name) setFocus(first);
        }
      }, h('span', { class: 'dot' }), h('span', { class: 'cf-name' }, f.name), h('span', { class: 'cf-sys' }, label));
      const select = () => {
        v.folder = f.name;
        foldersEl.querySelectorAll('.cloud-folder').forEach((b) => b.classList.toggle('on', b === btn));
        loadCloudItems(v, itemsEl);
      };
      // Al moverse por la lista con el control, la carpeta se abre sola tras una pausa corta.
      btn._onFocus = () => {
        setAccent(f.supported ? sysColor(f.system) : '#4f86f7');
        clearTimeout(renderCloud.t);
        if (f.supported && v.folder !== f.name) renderCloud.t = setTimeout(() => state.focusEl === btn && select(), 280);
      };
      return btn;
    }));
    restoreFocus(`[data-key="${CSS.escape(`cf:${v.folder}`)}"]`);
    loadCloudItems(v, itemsEl);
  }

  async function loadCloudItems(v, itemsEl, refresh = false) {
    const folders = state.cloud.folders[v.source] || [];
    const f = folders.find((x) => x.name === v.folder);
    if (!f || !f.supported) return;
    const key = `${v.source}|${f.name}`;
    itemsEl.replaceChildren(h('p', { class: 'lead' }, `Leyendo ${f.name}...`));
    let r;
    try {
      r = await call(api.cloudItems, v.source, f.path, f.system, refresh);
    } catch (e) {
      if (view() !== v || v.folder !== f.name) return;
      itemsEl.replaceChildren(h('div', { class: 'notice warn' }, h('h3', {}, `No pude leer ${f.name}`), h('p', {}, e.message)));
      return;
    }
    if (view() !== v || v.folder !== f.name) return;
    state.cloud.items[key] = r;
    paintItems(v, itemsEl, f, r, key);
  }

  function paintItems(v, itemsEl, f, r, key) {
    const pending = r.items.filter((u) => !u.downloaded && !inQueue(u.id));
    const total = r.items.reduce((t, u) => t + (u.size || 0), 0);
    const head = h('div', { class: 'ci-head' },
      h('div', {}, h('h2', {}, f.name),
        h('p', { class: 'sub' }, r.items.length
          ? `${r.items.length === 1 ? '1 juego' : `${r.items.length} juegos`}${total ? `, ${fmtSize(total)}` : ''}. Van a ${f.system === 'bios' ? 'la carpeta de BIOS' : sysById(f.system).name}.`
          : 'No hay juegos en esta carpeta todavía.')),
      h('div', { class: 'actions' },
        pending.length ? h('button', { class: 'btn small primary f', 'data-key': `cdl:${key}`, onclick: () => downloadAllPending(v) }, pending.length === 1 ? 'Descargar 1 pendiente' : `Descargar ${pending.length} pendientes`) : null,
        h('button', { class: 'btn small ghost f', onclick: () => loadCloudItems(v, itemsEl, true) }, 'Actualizar lista')));
    const list = h('div', { class: 'ci-list' }, r.items.map((u) => {
      const row = h('button', {
        class: 'cloud-item f', 'data-key': `ci:${u.id}`, 'data-id': u.id, 'data-list': key,
        onclick: twoStep(() => downloadUnits(v, f, [u]))
      },
      h('span', { class: 'ci-name' }, u.name, u.kind === 'dir' ? h('span', { class: 'ci-kind' }, ' (carpeta)') : null),
      h('span', { class: 'ci-size' }, fmtSize(u.size) || ''),
      itemChip(u));
      return row;
    }));
    itemsEl.replaceChildren(head, list);
  }

  async function downloadUnits(v, f, units) {
    const fresh = units.filter((u) => !u.downloaded && !inQueue(u.id));
    if (!fresh.length) {
      const u = units[0];
      if (u && u.downloaded) toast(`${u.name} ya está en tu biblioteca.`);
      return;
    }
    try {
      const n = await call(api.cloudDownload, v.source, f.path, f.system, fresh);
      toast(n === 1 ? `Descargando ${fresh[0].name}` : `${n} juegos en la fila de descargas`);
    } catch (e) {
      toast(e.message, true);
    }
  }

  function downloadAllPending(v) {
    const folders = state.cloud.folders[v.source] || [];
    const f = folders.find((x) => x.name === v.folder);
    const r = f && state.cloud.items[`${v.source}|${f.name}`];
    if (!r) return;
    downloadUnits(v, f, r.items);
  }

  function chooseFolderSystem(f, v) {
    const el = h('div', { class: 'sheet', style: { width: 'min(60rem, 92vw)' } },
      h('div', {}, h('h2', {}, `¿De qué consola es "${f.name}"?`),
        h('p', { class: 'sub' }, f.system === null && /^pc$/i.test(f.name)
          ? 'CanacaLabArcadia no ejecuta juegos de PC. Si en realidad son de una consola, elígela.'
          : 'No reconocí el nombre de esta carpeta. Elige su consola y lo recordaré.')),
      h('div', { class: 'letters' },
        [...state.catalog.systems.map((s) => h('button', { class: 'btn f', vars: { '--acento': s.color }, onclick: () => saveMapping(f, s.id, v) }, s.short)),
          h('button', { class: 'btn f', onclick: () => saveMapping(f, 'bios', v) }, 'BIOS')]),
      h('div', { class: 'foot' }, h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar')));
    openLayer({ el });
  }

  async function saveMapping(f, systemId, v) {
    try {
      await call(api.cloudSetMapping, f.name, systemId);
      closeLayer();
      v.folder = f.name;
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function connectGoogle() {
    const phase = h('p', { class: 'sub' }, 'Preparando...');
    const linkBox = h('div', { class: 'actions' });
    const el = h('div', { class: 'sheet', style: { width: 'min(50rem, 92vw)', gridTemplateRows: 'auto auto auto' } },
      h('div', {}, h('h2', {}, 'Conectar cuenta de Google'), phase,
        h('p', { class: 'sub' }, 'Se abrirá tu navegador. Inicia sesión con la cuenta donde están tus juegos y acepta el permiso de solo lectura. Cuando el navegador diga "Success", regresa aquí.')),
      linkBox,
      h('div', { class: 'foot' }, h('span', { class: 'push' }),
        h('button', { class: 'btn ghost f', 'data-key': 'cc-cancel', onclick: () => api.cloudCancelConnect() }, 'Cancelar')));
    openLayer({ el, cancelable: false, focus: '[data-key="cc-cancel"]' });
    const offs = [
      api.on('cloud:setup', (p) => { phase.textContent = p.pct != null ? `${p.phase} ${p.pct}%` : p.phase; }),
      api.on('cloud:authLink', ({ url }) => {
        phase.textContent = 'Esperando a que inicies sesión en el navegador...';
        linkBox.replaceChildren(h('button', { class: 'btn f', onclick: () => api.cloudOpenLink(url) }, 'Si el navegador no se abrió, ábrelo aquí'));
      })
    ];
    try {
      const st = await call(api.cloudConnect);
      state.cloud.status = st;
      closeLayer();
      const last = st.cuentas[st.cuentas.length - 1];
      state.cloudInfo = { ...state.cloudInfo, connected: true };
      toast(`Cuenta conectada${last ? `: ${last.nombre}` : ''}. Tus juegos de Drive aparecen en un momento.`);
      render();
    } catch (e) {
      closeLayer();
      toast(e.message, true);
    } finally {
      offs.forEach((off) => off && off());
    }
  }

  function accountName(st, remote) {
    if (remote) {
      const c = st.cuentas.find((x) => x.remoto === remote);
      return c ? c.nombre : `${remote} (no conectada)`;
    }
    return st.cuentas[0] ? `${st.cuentas[0].nombre} (principal)` : 'ninguna conectada';
  }

  function editSource(st, c) {
    const nombre = h('input', { class: 'input f', type: 'text', value: c ? c.nombre : '', placeholder: 'Por ejemplo: ROMs de mi otra cuenta', 'aria-label': 'Nombre' });
    const enlace = h('input', { class: 'input f', type: 'url', value: c ? c.enlace : '', placeholder: 'https://drive.google.com/drive/folders/...', 'aria-label': 'Enlace' });
    let cuenta = c ? c.cuenta || '' : '';
    const chips = h('div', { class: 'letters' });
    const paintChips = () => chips.replaceChildren(
      h('button', { class: `btn small f${cuenta === '' ? ' sel' : ''}`, onclick: () => { cuenta = ''; paintChips(); } }, 'La principal'),
      ...st.cuentas.map((a) => h('button', { class: `btn small f${cuenta === a.remoto ? ' sel' : ''}`, onclick: () => { cuenta = a.remoto; paintChips(); } }, a.nombre)));
    paintChips();
    const save = async () => {
      try {
        state.cloud.status = await call(api.cloudSaveSource, { id: c ? c.id : null, nombre: nombre.value, enlace: enlace.value, cuenta });
        closeLayer();
        toast(c ? 'Carpeta actualizada.' : 'Carpeta agregada.');
        state.cloudInfo = { ...(state.cloudInfo || {}), hasFolders: true };
        render();
      } catch (e) {
        toast(e.message, true);
      }
    };
    const el = h('div', { class: 'sheet', style: { width: 'min(56rem, 92vw)' } },
      h('div', {}, h('h2', {}, c ? 'Editar carpeta' : 'Agregar carpeta de Google Drive'),
        h('p', { class: 'sub' }, 'Copia el enlace de la carpeta desde Google Drive (Compartir > Copiar enlace) y pégalo aquí.')),
      h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', {}, 'Nombre'), nombre),
        h('label', { class: 'field' }, h('span', {}, 'Enlace de la carpeta'), enlace),
        h('div', { class: 'field' }, h('span', {}, 'Cuenta que la puede leer'), chips)),
      h('div', { class: 'foot' }, h('span', { class: 'push' }),
        h('button', { class: 'btn ghost f', onclick: closeLayer }, 'Cancelar'),
        h('button', { class: 'btn primary f', 'data-key': 'src-save', onclick: save }, 'Guardar')));
    openLayer({ el, focus: c ? '[data-key="src-save"]' : 'input' });
  }

  async function removeSource(c) {
    try {
      state.cloud.status = await call(api.cloudRemoveSource, c.id);
      toast(`Se quitó "${c.nombre}". Tus juegos descargados no se borran.`);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function removeAccount(c) {
    try {
      state.cloud.status = await call(api.cloudRemoveAccount, c.remoto);
      toast(`Se desconectó ${c.nombre}.`);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function paneNube(pane, v) {
    pane.append(
      h('h2', {}, 'Nube (Google Drive)'),
      h('p', { class: 'lead' }, 'Descarga tus juegos directo de tus carpetas de Google Drive. Puedes conectar varias cuentas y agregar varias carpetas; todo queda guardado en config\\nube.json dentro de tu biblioteca.'),
      h('div', { class: 'actions', style: { marginBottom: '1.6rem' } },
        h('button', { class: 'btn primary f', 'data-key': 'cloud-open', onclick: () => openCloud() }, 'Explorar y descargar')));
    const box = h('div', {}, h('p', { class: 'lead' }, 'Leyendo la configuración...'));
    pane.append(box);
    let st;
    try {
      st = await cloudStatus(true);
    } catch (e) {
      box.replaceChildren(h('p', { class: 'lead' }, e.message));
      return;
    }
    if (view() !== v) return;
    box.replaceChildren(
      h('h3', { class: 'section-title', style: { marginBottom: '0.8rem' } }, 'Cuentas de Google'),
      h('div', { class: 'rows' }, st.cuentas.length
        ? st.cuentas.map((c, i) => h('div', { class: 'row' },
          h('div', { class: 'who' }, h('strong', {}, c.nombre, i === 0 ? h('span', { class: 'chip', style: { marginLeft: '0.6rem' } }, 'Principal') : null),
            h('span', {}, c.activa ? 'Conectada, solo lectura.' : 'La sesión venció o se borró: quítala y vuelve a conectarla.')),
          h('div', { class: 'act' }, h('button', { class: 'btn small ghost f', onclick: () => removeAccount(c) }, 'Desconectar'))))
        : h('div', { class: 'row' }, h('div', { class: 'who' }, h('strong', {}, 'Sin cuentas conectadas'),
          h('span', {}, 'Conecta la cuenta donde están tus juegos. Si la carpeta es de otra cuenta, compártela con esta.')))),
      h('div', { class: 'actions', style: { margin: '0.9rem 0 2.2rem' } },
        h('button', { class: 'btn f', 'data-key': 'cloud-connect', onclick: connectGoogle }, st.cuentas.length ? 'Conectar otra cuenta' : 'Conectar cuenta de Google')),
      h('h3', { class: 'section-title', style: { marginBottom: '0.8rem' } }, 'Carpetas'),
      h('div', { class: 'rows' }, st.carpetas.length
        ? st.carpetas.map((c) => h('div', { class: 'row' },
          h('div', { class: 'who' }, h('strong', {}, c.nombre),
            h('span', {}, h('span', { class: 'path' }, c.enlace)),
            h('span', {}, `Cuenta: ${accountName(st, c.cuenta)}`),
            c.valida ? null : h('span', { style: { color: '#ffd894' } }, 'El enlace no es una carpeta de Google Drive.')),
          h('div', { class: 'act' },
            h('button', { class: 'btn small f', onclick: () => openCloud(null, c.id) }, 'Explorar'),
            h('button', { class: 'btn small ghost f', onclick: () => editSource(st, c) }, 'Editar'),
            h('button', { class: 'btn small ghost f', onclick: () => removeSource(c) }, 'Quitar'))))
        : h('div', { class: 'row' }, h('div', { class: 'who' }, h('strong', {}, 'Sin carpetas'), h('span', {}, 'Agrega el enlace de una carpeta de Google Drive.')))),
      h('div', { class: 'actions', style: { margin: '0.9rem 0 2.2rem' } },
        h('button', { class: 'btn f', onclick: () => editSource(st, null) }, 'Agregar carpeta'),
        h('button', { class: 'btn ghost f', onclick: () => api.cloudOpenConfig() }, 'Abrir nube.json')),
      h('div', { class: 'notice' },
        h('h3', {}, 'Cómo se acomodan los juegos'),
        h('p', {}, 'Cada subcarpeta va a su consola por su nombre: PS2, Nintendo 64, Xbox 360, etc. La carpeta BIOS va a la carpeta de BIOS (y neogeo.zip también junto a Neo Geo). Los .zip y .7z de consolas que no los leen, como PS2 o GameCube, se descomprimen solos. Un .cue se descarga con sus .bin, y una subcarpeta dentro de una consola se descarga completa (así van los juegos de PS3, PS4 y Xbox 360).'),
        h('p', {}, 'Si una subcarpeta no se reconoce, tócala en "Explorar" y elige su consola. El mapeo queda guardado en nube.json.')));
  }

  api.on('cloud:queue', (q) => {
    state.cloud.queue = q;
    paintQueue();
    refreshItemChips();
    refreshCloudBadges();
    paintPrepFromQueue();
    paintAuto();
  });

  api.on('cloud:progress', (p) => {
    const q = state.cloud.queue;
    if (q && q.current && q.current.id === p.id) Object.assign(q.current, p);
    paintQueue();
    refreshItemChips();
    refreshCloudBadges();
    paintPrepFromQueue();
    paintAuto();
  });

  function refreshCloudBadges() {
    for (const el of document.querySelectorAll('.cloud-badge[data-cloud]')) {
      const g = findGame(el.dataset.cloud);
      if (g) el.replaceWith(cloudBadge(g));
    }
  }

  // Si estas viendo la biblioteca, se vuelve a dibujar con los cambios (el foco se queda donde estaba).
  function refreshLibraryView() {
    const v = view();
    if (state.layers.length || !(v.name === 'home' || v.name === 'system')) return;
    const key = state.focusEl && state.focusEl.dataset.key;
    if (key) state.focusKey[viewId()] = key;
    render();
  }

  api.on('cloud:games', (d) => {
    if (d.games) state.cloudGames = d.games;
    if (d.info) state.cloudInfo = d.info;
    refreshLibraryView();
  });

  api.on('library:update', (d) => {
    if (d.library) state.library = d.library;
    if (d.status) state.status = d.status;
    if (d.cloudGames) state.cloudGames = d.cloudGames;
    refreshLibraryView();
  });

  api.on('launch:prep', (d) => {
    const prep = state.prep;
    if (prep && !prep.cloudJob && (d.id === prep.id || d.id === null)) prep.update(d.phase, d.pct);
    else if (d.id === null) { state.auto = { busy: true, label: d.phase, pct: d.pct }; paintAuto(); }
  });

  api.on('auto:status', (st) => {
    state.auto = st;
    paintAuto();
  });

  // Chip de la barra superior: lo que CanacaLabArcadia esta haciendo sola.
  function paintAuto() {
    const el = $('#auto-state');
    if (!el) return;
    const q = (state.cloud && state.cloud.queue) || {};
    const job = q.current;
    let text = '';
    if (job) {
      const pct = job.total ? Math.min(99, Math.round((job.bytes / job.total) * 100)) : null;
      const more = (q.pending || []).length;
      text = `\u2601 ${job.quiet ? 'Bajando BIOS y extras' : `Bajando ${job.name}`}${pct != null ? ` ${pct}%` : ''}${more ? ` (+${more})` : ''}`;
    } else if (state.auto && state.auto.busy) {
      text = `${state.auto.label}${state.auto.pct != null ? ` ${state.auto.pct}%` : '...'}`;
    }
    el.textContent = text;
    el.title = text;
  }

  // El proceso principal termino algo en segundo plano (por ejemplo, instalar llaves y firmware de Switch).
  api.on('status:update', (d) => {
    if (d.status) state.status = d.status;
    if (d.message) toast(d.message);
    if (d.error) toast(d.error, true);
    const v = view();
    if (!state.layers.length && (v.name === 'home' || v.name === 'system')) render();
  });

  api.on('cloud:done', (d) => {
    if (d.library) state.library = d.library;
    if (d.status) state.status = d.status;
    if (d.cloudGames) state.cloudGames = d.cloudGames;
    for (const list of Object.values(state.cloud.items)) {
      const u = list.items.find((x) => x.id === d.id);
      if (u && d.ok) u.downloaded = true;
    }
    refreshItemChips();
    paintAuto();
    const waiting = state.prep && state.prep.cloudJob === d.id;
    if (waiting) {
      closePrep();
      const g = d.ok && d.playGameId && findGame(d.playGameId);
      if (g && !state.playing) { launch(g); return; }
      if (d.ok) toast(`${d.name} ya está en tu biblioteca.`);
    }
    if (!waiting) refreshLibraryView();
    if (d.ok && !d.quiet && !waiting) toast(`${d.name} listo para jugar.`);
    else if (!d.ok && d.error !== 'Cancelado') toast(`No se pudo descargar ${d.name}: ${d.error}`, true);
  });

  // ------------------------------------------------------------------ eventos del proceso principal

  api.on('emu:progress', (p) => {
    if (!p || !p.emu) return;
    state.installing[p.emu] = { phase: p.phase, pct: p.pct };
    const row = $(`.row[data-emu="${p.emu}"]`);
    if (row) {
      const bar = row.querySelector('.bar i');
      const phase = row.querySelector('.who > span:last-child');
      if (bar) {
        bar.parentElement.classList.toggle('indet', p.pct == null);
        bar.style.width = `${p.pct || 0}%`;
      } else refreshEmuRow(p.emu);
      if (phase) phase.textContent = p.phase || '';
    }
  });

  api.on('game:started', () => { /* la ventana se minimiza sola */ });

  api.on('game:ended', (p) => {
    state.playing = null;
    if (p.userData) state.userData = p.userData;
    while (state.layers.length) state.layers.pop();
    $('#layer').replaceChildren();
    const g = p.id && findGame(p.id);
    render();
    if (g && p.seconds >= 60) toast(`Jugaste ${fmtDuration(p.seconds)} de ${g.title}.`);
    else if (g && p.code && p.code !== 0 && !p.forced) toast(`El emulador se cerró con un error (código ${p.code}). Abre el emulador desde Menú > Emuladores para revisar su configuración.`, true);
  });

  api.on('game:error', (p) => {
    state.playing = null;
    while (state.layers.length) state.layers.pop();
    $('#layer').replaceChildren();
    toast(`No se pudo abrir el emulador: ${p.message}`, true);
    render();
  });

  // ------------------------------------------------------------------ barra superior

  function tickClock() {
    const now = new Date();
    $('#clock').textContent = now.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  }

  async function watchBattery() {
    if (!navigator.getBattery) return;
    try {
      const b = await navigator.getBattery();
      const upd = () => { $('#battery').textContent = `${Math.round(b.level * 100)} %${b.charging ? ' cargando' : ''}`; };
      upd();
      b.addEventListener('levelchange', upd);
      b.addEventListener('chargingchange', upd);
    } catch { /* sin bateria */ }
  }

  // ------------------------------------------------------------------ arranque

  async function boot() {
    try {
      const d = await call(api.init);
      Object.assign(state, {
        settings: d.settings, catalog: d.catalog, library: d.library, status: d.status, userData: d.userData,
        comboAvailable: d.comboAvailable, suggestedRoot: d.suggestedRoot,
        cloudGames: d.cloudGames || {}, cloudInfo: d.cloudInfo || state.cloudInfo, auto: d.auto || null
      });
      state.stack = d.settings.dataRoot ? [{ name: 'home' }] : [{ name: 'welcome' }];
      const hashView = location.hash.match(/#(system|settings|cloud):?(\w+)?/);
      if (api.__mock && hashView) {
        if (hashView[1] === 'system') state.stack.push({ name: 'system', system: hashView[2] || 'ps2' });
        else if (hashView[1] === 'cloud') state.stack.push({ name: 'cloud', system: hashView[2] || null });
        else state.stack.push({ name: 'settings', tab: hashView[2] || 'emuladores' });
      }
      render();
      paintAuto();
    } catch (e) {
      $('#screen').replaceChildren(h('div', { class: 'empty-state', style: { padding: '0 6vw' } }, h('h2', {}, 'CanacaLabArcadia no pudo arrancar'), h('p', {}, e.message)));
    }
    tickClock();
    setInterval(tickClock, 15000);
    watchBattery();
    requestAnimationFrame(pollPads);
  }

  boot();
})();
