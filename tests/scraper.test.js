'use strict';
// Portadas inteligentes: IGDB, ScreenScraper y libretro, con servidores simulados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const sc = require('../src/main/scraper');

const catalog = loadCatalog();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 2)]);

test('busqueda inteligente: titulos limpios y parecido', () => {
  assert.equal(sc.searchTitle({ title: 'Copia de Mario Kart 64 (USA)' }), 'Mario Kart 64');
  assert.equal(sc.searchTitle({ rawName: "BLUS30443 - Demon's Souls" }), "Demon's Souls");
  assert.equal(sc.searchTitle({ title: 'Super Smash Bros. Ultimate [01006A800016E000][v0]' }), 'Super Smash Bros. Ultimate');
  assert.equal(sc.similarity('The Legend of Zelda - Breath of the Wild', 'The Legend of Zelda: Breath of the Wild'), 1);
  assert.equal(sc.similarity('Final Fantasy X', 'Final Fantasy 10'), 1, 'numeros romanos');
  assert.ok(sc.similarity('Mario Kart 64', 'Mario Kart 8 Deluxe') < 0.6, 'otro juego de la serie no cuenta');
  assert.ok(sc.similarity('Okami', 'Okami HD') >= 0.6);
});

test('llaves: se guardan sin borrar lo anterior y la interfaz no ve las claves', () => {
  const root = h.tmpDir('biblio-');
  sc.saveScraperConfig(root, { igdb: { clientId: 'abc', clientSecret: 'secreto' } });
  const again = sc.saveScraperConfig(root, { igdb: { clientId: 'abc', clientSecret: '' }, screenscraper: { usuario: 'jugadora' } });
  assert.equal(again.igdb.clientSecret, 'secreto', 'un campo vacio no borra la clave guardada');
  const pub = sc.publicScraperConfig(again);
  assert.equal(pub.igdb.clientSecret, true);
  assert.equal(JSON.stringify(pub).includes('secreto'), false);
  assert.deepEqual(pub.activas, ['igdb', 'libretro'], 'ScreenScraper necesita el ID de desarrollador');
  assert.ok(fs.existsSync(path.join(root, 'config', 'portadas.json')));
});

function fakeIgdb(games, calls = []) {
  return async (url, opts = {}) => {
    calls.push({ url, body: opts.body, headers: opts.headers });
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      if (!url.includes('client_secret=bien')) return new Response('bad', { status: 400 });
      return Response.json({ access_token: 'tok', expires_in: 5000000 });
    }
    if (url === 'https://api.igdb.com/v4/games') return Response.json(games);
    if (url === 'https://api.igdb.com/v4/platforms') return Response.json([{ id: 130, name: 'Nintendo Switch' }]);
    if (url.startsWith('https://images.igdb.com/')) return new Response(JPG);
    return new Response('no', { status: 404 });
  };
}

test('IGDB: busca en la consola correcta y elige el juego mas parecido', async () => {
  const calls = [];
  const igdb = new sc.Igdb({
    clientId: 'id', clientSecret: 'bien', minGapMs: 0,
    fetchImpl: fakeIgdb([
      { id: 1, name: 'Mario Kart 8 Deluxe', cover: { image_id: 'mk8' } },
      { id: 2, name: 'Mario Kart 64', cover: { image_id: 'mk64' } },
      { id: 3, name: 'Mario Kart: Double Dash!!', cover: { image_id: 'mkdd' } }
    ], calls)
  });
  const hit = await igdb.findCover({ system: 'n64', title: 'Mario Kart 64', rawName: 'Copia de Mario Kart 64 (USA)' });
  assert.equal(hit.name, 'Mario Kart 64');
  assert.equal(hit.url, 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/mk64.jpg');
  const q = calls.find((c) => c.url.endsWith('/games'));
  assert.match(q.body, /search "Mario Kart 64"/);
  assert.match(q.body, /where platforms = \(4\)/);
  assert.equal(q.headers['Client-ID'], 'id');
  assert.equal(q.headers.Authorization, 'Bearer tok');
  // Nada parecido: mejor sin portada que con la de otro juego.
  const none = new sc.Igdb({ clientId: 'id', clientSecret: 'bien', minGapMs: 0, fetchImpl: fakeIgdb([{ id: 9, name: 'Pac-Man', cover: { image_id: 'p' } }]) });
  assert.equal(await none.findCover({ system: 'n64', title: 'Mario Kart 64' }), null);
  // Llaves malas: mensaje claro.
  const bad = await sc.testScraperConfig({ igdb: { clientId: 'id', clientSecret: 'mal' }, screenscraper: {} }, fakeIgdb([]));
  assert.match(bad.igdb, /no aceptó tu Client ID/);
  const good = await sc.testScraperConfig({ igdb: { clientId: 'id', clientSecret: 'bien' }, screenscraper: {} }, fakeIgdb([]));
  assert.equal(good.igdb, 'ok');
});

function fakeSs(calls = []) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/ssuserInfos.php')) return Response.json({ response: { ssuser: { id: 'jugadora', requeststoday: '3', maxrequestsperday: '20000' } } });
    if (u.pathname.endsWith('/jeuInfos.php')) {
      if (u.searchParams.get('romnom') === 'nada.zip') return new Response('Erreur : Rom/Iso/Dossier non trouvée !', { status: 404 });
      return Response.json({ response: { jeu: { noms: [{ region: 'us', text: 'Metal Slug X' }], medias: [
        { type: 'box-2D', region: 'jp', url: 'https://media.example/jp.png' },
        { type: 'box-2D', region: 'us', url: 'https://media.example/us.png' },
        { type: 'ss', region: 'wor', url: 'https://media.example/ss.png' }
      ] } } });
    }
    if (url === 'https://media.example/us.png') return new Response(PNG);
    return new Response('no', { status: 404 });
  };
}

test('ScreenScraper: reconoce el archivo (huella, nombre, tamano, consola) y prefiere la caja de America', async () => {
  const calls = [];
  const ss = new sc.ScreenScraper({ devid: 'dev', devclave: 'dp', usuario: 'jugadora', clave: 'k', fetchImpl: fakeSs(calls) });
  const hit = await ss.findCover({ system: 'neogeo', rawName: 'mslugx', fileName: 'mslugx.zip' }, { md5: 'abc123', size: 1000 });
  assert.equal(hit.url, 'https://media.example/us.png');
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get('systemeid'), '142');
  assert.equal(u.searchParams.get('md5'), 'abc123');
  assert.equal(u.searchParams.get('romtaille'), '1000');
  assert.equal(u.searchParams.get('romnom'), 'mslugx.zip');
  assert.equal(u.searchParams.get('devid'), 'dev');
  assert.equal(u.searchParams.get('ssid'), 'jugadora');
  assert.equal(u.searchParams.get('softname'), 'CanacaLabArcadia');
  assert.equal(await ss.findCover({ system: 'neogeo', rawName: 'nada', fileName: 'nada.zip' }), null);
  const t = await sc.testScraperConfig({ igdb: {}, screenscraper: { devid: 'dev', devclave: 'dp', usuario: 'jugadora', clave: 'k' } }, fakeSs());
  assert.equal(t.screenscraper, 'ok: 3 de 20000 consultas hoy');
});

test('portadas: ScreenScraper primero, luego IGDB y al final libretro; se guardan en media/covers', async () => {
  const root = h.tmpDir('biblio-');
  const romDir = path.join(root, 'roms', 'neogeo');
  fs.mkdirSync(romDir, { recursive: true });
  fs.writeFileSync(path.join(romDir, 'mslugx.zip'), h.buildZip(['250-p1.p1']));
  const ssCalls = [];
  const igCalls = [];
  const ss = fakeSs(ssCalls);
  const ig = fakeIgdb([{ id: 5, name: "Demon's Souls", cover: { image_id: 'ds' } }], igCalls);
  const libretro = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes('screenscraper') || url.startsWith('https://media.example')) return ss(url, opts);
    if (url.includes('twitch') || url.includes('igdb')) return ig(url, opts);
    libretro.push(url);
    return url.includes('Super%20Mario%20World') ? new Response(PNG) : new Response('no', { status: 404 });
  };
  const config = { screenscraper: { devid: 'dev', devclave: 'dp', usuario: '', clave: '' }, igdb: { clientId: 'id', clientSecret: 'bien' } };
  const items = [
    { sys: catalog.byId.neogeo, g: { title: 'Metal Slug X', rawName: 'mslugx', path: path.join(romDir, 'mslugx.zip'), launch: path.join(romDir, 'mslugx.zip') } },
    { sys: catalog.byId.ps3, g: { title: "Demon's Souls", rawName: "BLUS30443 - Demon's Souls", cloud: true, folderGame: true, size: 5e9 } },
    { sys: catalog.byId.snes, g: { title: 'Super Mario World', rawName: 'Super Mario World (USA)', cloud: true } }
  ];
  // ScreenScraper no conoce Demon's Souls ni Mario World en esta prueba.
  const ssOnly = async (url, opts) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/jeuInfos.php') && u.searchParams.get('systemeid') !== '142') return new Response('no', { status: 404 });
    return fetchImpl(url, opts);
  };
  const r = await sc.fetchSmartCovers(root, items, { fetchImpl: ssOnly, config });
  assert.equal(r.found, 3);
  assert.deepEqual(r.bySource, { screenscraper: 1, igdb: 1, libretro: 1 });
  assert.ok(fs.existsSync(path.join(root, 'media', 'covers', 'neogeo', 'mslugx.png')));
  assert.ok(fs.existsSync(path.join(root, 'media', 'covers', 'ps3', "BLUS30443 - Demon's Souls.jpg")));
  assert.ok(fs.existsSync(path.join(root, 'media', 'covers', 'snes', 'Super Mario World (USA).png')));
  const md5 = new URL(ssCalls[0]).searchParams.get('md5');
  assert.match(md5, /^[0-9a-f]{32}$/, 'manda la huella del archivo');
  // Sin llaves: solo libretro, y lo que no encuentra queda anotado para no repetirlo.
  const none = await sc.fetchSmartCovers(h.tmpDir('biblio-'), [items[1]], { fetchImpl, config: { screenscraper: {}, igdb: {} } });
  assert.equal(none.found, 0);
  assert.deepEqual(none.misses, ["ps3/BLUS30443 - Demon's Souls"]);
});
