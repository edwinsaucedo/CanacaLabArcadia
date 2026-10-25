'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { loadCatalog } = require('../src/main/catalog');
const { checkBios, biosMessage } = require('../src/main/bios');

const catalog = loadCatalog();
const neogeo = catalog.byId.neogeo;
// Los CRC que FBNeo pidio en la pantalla de error de Metal Slug X.
const GOOD = { 'sp-s3.sp1': '91b64be3', 'sm1.sm1': '94416d67', 'sfix.sfix': 'c2ea0cfd', '000-lo.lo': '5a86cff2' };

function library() {
  const root = h.tmpDir('bios-');
  fs.mkdirSync(path.join(root, 'roms', 'neogeo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bios'), { recursive: true });
  const rom = path.join(root, 'roms', 'neogeo', 'mslugx.zip');
  fs.writeFileSync(rom, h.buildZip(['250-p1.p1', '250-c1.c1']));
  return { root, rom };
}

test('Neo Geo sin neogeo.zip: avisa antes de abrir el juego', () => {
  const { root, rom } = library();
  const r = checkBios(root, neogeo, rom);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].kind, 'falta');
  assert.match(biosMessage(neogeo, r.problems, root), /Falta el BIOS neogeo\.zip.*carpeta BIOS de tu Google Drive/);
});

test('neogeo.zip viejo o incompleto: dice que archivos le faltan', () => {
  const { root, rom } = library();
  fs.writeFileSync(path.join(root, 'bios', 'neogeo.zip'),
    h.buildZip(['sp-s2.sp1', 'sm1.sm1', 'sfix.sfx', '000-lo.lo'], { 'sm1.sm1': GOOD['sm1.sm1'], '000-lo.lo': GOOD['000-lo.lo'] }));
  const r = checkBios(root, neogeo, rom);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].kind, 'incompleto');
  assert.deepEqual(r.problems[0].faltan, ['sp-s3.sp1', 'sfix.sfix']);
  assert.match(biosMessage(neogeo, r.problems, root), /le falta sp-s3\.sp1, sfix\.sfix/);
});

test('neogeo.zip correcto en la carpeta bios: se copia a bios/fbneo, donde lo lee FBNeo', () => {
  const { root, rom } = library();
  // El nombre dentro del zip puede variar entre sets; se reconoce por CRC.
  fs.writeFileSync(path.join(root, 'bios', 'neogeo.zip'), h.buildZip(['sp-s3.sp1', 'sm1.sm1', 'sfix.sfix', '000-lo.lo'], GOOD));
  const r = checkBios(root, neogeo, rom);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(fs.existsSync(path.join(root, 'bios', 'fbneo', 'neogeo.zip')));
});

test('neogeo.zip correcto junto a los juegos: listo para jugar', () => {
  const { root, rom } = library();
  fs.writeFileSync(path.join(root, 'roms', 'neogeo', 'neogeo.zip'), h.buildZip(Object.keys(GOOD), GOOD));
  assert.equal(checkBios(root, neogeo, rom).ok, true);
});

test('consolas sin BIOS obligatorio no se revisan', () => {
  const { root } = library();
  assert.equal(checkBios(root, catalog.byId.snes, null).ok, true);
});
