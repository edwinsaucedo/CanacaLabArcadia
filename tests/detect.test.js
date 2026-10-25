'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { detect } = require('../src/main/detect');
const { parseSfo, readPbpSfo } = require('../src/main/sfo');

const dir = h.tmpDir();
const put = (rel, buf) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  return p;
};

test('PS2 ISO (SYSTEM.CNF con BOOT2)', () => {
  const p = put('juegos/Final Fantasy X (USA).iso', h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_200.62;1\r\nVER = 1.00' }));
  const r = detect(p);
  assert.equal(r.system, 'ps2');
  assert.equal(r.confidence, 'alta');
});

test('PSP ISO (UMD_DATA.BIN + PSP_GAME)', () => {
  const p = put('juegos/Crisis Core.iso', h.buildIso9660({ 'UMD_DATA.BIN': 'ULUS10336|', 'PSP_GAME/': null }));
  assert.equal(detect(p).system, 'psp');
});

test('PSP CSO comprimido', () => {
  const p = put('juegos/God of War.cso', h.toCso(h.buildIso9660({ 'UMD_DATA.BIN': 'UCUS98737|', 'PSP_GAME/': null })));
  const r = detect(p);
  assert.equal(r.system, 'psp', r.reason);
});

test('PS2 CSO comprimido', () => {
  const p = put('juegos/Okami.cso', h.toCso(h.buildIso9660({ 'SYSTEM.CNF': 'BOOT2 = cdrom0:\\SLUS_215.15;1' })));
  assert.equal(detect(p).system, 'ps2');
});

test('PS1 CUE/BIN crudo MODE2/2352', () => {
  put('psx/Crash Bandicoot (USA).bin', h.toRawMode2(h.buildIso9660({ 'SYSTEM.CNF': 'BOOT = cdrom:\\SCUS_949.00;1\r\nTCB = 4' })));
  const cue = put('psx/Crash Bandicoot (USA).cue', 'FILE "Crash Bandicoot (USA).bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n');
  const r = detect(cue);
  assert.equal(r.system, 'ps1', r.reason);
});

test('PS3 ISO (PS3_DISC.SFB)', () => {
  const p = put('juegos/Demons Souls.iso', h.buildIso9660({ 'PS3_DISC.SFB': '.SFB', 'PS3_GAME/': null }));
  assert.equal(detect(p).system, 'ps3');
});

test('GameCube y Wii por numero magico', () => {
  assert.equal(detect(put('juegos/Smash Melee.iso', h.nintendoDisc('gc', 'GALE01'))).system, 'gamecube');
  assert.equal(detect(put('juegos/Mario Kart Wii.iso', h.nintendoDisc('wii', 'RMCE01'))).system, 'wii');
  const gc = detect(put('juegos/Melee.gcm', h.nintendoDisc('gc')));
  assert.equal(gc.system, 'gamecube');
});

test('RVZ distingue GameCube de Wii', () => {
  assert.equal(detect(put('juegos/Wind Waker.rvz', h.rvz(1))).system, 'gamecube');
  assert.equal(detect(put('juegos/Galaxy.rvz', h.rvz(2))).system, 'wii');
});

test('Xbox XISO (default.xbe) y Xbox 360 (default.xex)', () => {
  const x = path.join(dir, 'juegos', 'Halo.iso');
  h.writeXboxImage(x, 0, 'default.xbe');
  assert.equal(detect(x).system, 'xbox');
  const x360 = path.join(dir, 'juegos', 'Gears trimmed.iso');
  h.writeXboxImage(x360, 0, 'default.xex');
  assert.equal(detect(x360).system, 'xbox360');
});

test('Xbox 360 XGD2 y Xbox redump (necesita XISO)', () => {
  const xgd2 = path.join(dir, 'juegos', 'Halo 3.iso');
  h.writeXboxImage(xgd2, 0x0fd90000, 'default.xex');
  assert.equal(detect(xgd2).system, 'xbox360');
  const xgd1 = path.join(dir, 'juegos', 'Halo CE (redump).iso');
  h.writeXboxImage(xgd1, 0x18300000, 'default.xbe');
  const r = detect(xgd1);
  assert.equal(r.system, 'xbox');
  assert.equal(r.needsXiso, true);
});

test('ZIP: ROM de consola, Neo Geo y MAME', () => {
  assert.equal(detect(put('zips/Super Mario World (USA).zip', h.buildZip(['Super Mario World (USA).sfc']))).system, 'snes');
  assert.equal(detect(put('zips/mslug.zip', h.buildZip(['201-p1.p1', '201-c1.c1', '201-c2.c2', '201-s1.s1', '201-m1.m1', '201-v1.v1']))).system, 'neogeo');
  assert.equal(detect(put('zips/sf2.zip', h.buildZip(['sf2_30a.bin', 'sf2_37a.bin', 'sf2-5m.4a']))).system, 'mame');
  const bios = detect(put('zips/neogeo.zip', h.buildZip(['sp-s2.sp1', '000-lo.lo', 'sfix.sfix'])));
  assert.equal(bios.system, 'neogeo');
  assert.equal(bios.isBios, true);
});

test('Extensiones unicas', () => {
  assert.equal(detect(put('x/Zelda.z64', Buffer.alloc(16))).system, 'n64');
  assert.equal(detect(put('x/Pokemon Emerald.gba', Buffer.alloc(16))).system, 'gba');
  assert.equal(detect(put('x/Mario Odyssey.nsp', Buffer.alloc(16))).system, 'switch');
  assert.equal(detect(put('x/Sonic.md', Buffer.alloc(16))).system, 'genesis');
});

test('Pista de carpeta para formatos ambiguos (.chd)', () => {
  assert.equal(detect(put('PS2/Shadow of the Colossus.chd', Buffer.alloc(64))).system, 'ps2');
  const r = detect(put('varios/algo.chd', Buffer.alloc(64)));
  assert.equal(r.system, null);
  assert.ok(r.candidates.includes('ps2'));
});

test('Carpetas de PS3 y PS4 con nombre real desde PARAM.SFO', () => {
  put('ps3/BLUS30443/PS3_GAME/USRDIR/EBOOT.BIN', Buffer.alloc(8));
  put('ps3/BLUS30443/PS3_GAME/PARAM.SFO', h.buildSfo({ TITLE: "Demon's Souls", TITLE_ID: 'BLUS30443' }));
  const r3 = detect(path.join(dir, 'ps3/BLUS30443'));
  assert.equal(r3.system, 'ps3');
  assert.equal(r3.title, "Demon's Souls");
  assert.ok(r3.launch.endsWith('EBOOT.BIN'));

  put('ps4/CUSA00900/eboot.bin', Buffer.alloc(8));
  put('ps4/CUSA00900/sce_sys/param.sfo', h.buildSfo({ TITLE: 'Bloodborne', TITLE_ID: 'CUSA00900', APP_VER: '01.09' }));
  const r4 = detect(path.join(dir, 'ps4/CUSA00900'));
  assert.equal(r4.system, 'ps4');
  assert.equal(r4.title, 'Bloodborne');
});

test('PBP: PSP vs PSone Classic', () => {
  const psp = put('pbp/psp/EBOOT.PBP', h.buildPbp(h.buildSfo({ TITLE: 'Patapon', CATEGORY: 'UG' })));
  const ps1 = put('pbp/ps1/EBOOT.PBP', h.buildPbp(h.buildSfo({ TITLE: 'Final Fantasy VII', CATEGORY: 'ME' })));
  assert.equal(detect(psp).system, 'psp');
  assert.equal(detect(ps1).system, 'ps1');
  assert.equal(readPbpSfo(ps1).TITLE, 'Final Fantasy VII');
});

test('SFO con enteros', () => {
  const sfo = parseSfo(h.buildSfo({ TITLE: 'X', PARENTAL_LEVEL: 5 }));
  assert.equal(sfo.PARENTAL_LEVEL, 5);
  assert.equal(sfo.TITLE, 'X');
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
