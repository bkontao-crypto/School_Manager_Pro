// Tests unitaires : lecture des dimensions d'image et exigences de l'affiche d'accueil.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectImage, checkBanner, BANNER_REQUIREMENTS } = require('../../backend/src/utils/image');

function png(w, h, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w, h) {
  // SOI + APP0 (16 octets) + SOF0
  const b = Buffer.alloc(2 + 18 + 19);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xe0; b.writeUInt16BE(16, 4);
  const o = 20; b[o] = 0xff; b[o + 1] = 0xc0; b.writeUInt16BE(17, o + 2); b[o + 4] = 8; b.writeUInt16BE(h, o + 5); b.writeUInt16BE(w, o + 7);
  return b;
}
function webpX(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

test('inspectImage : PNG, JPEG et WebP reconnus par signature', () => {
  assert.deepEqual(inspectImage(png(1600, 400)).width, 1600);
  const j = inspectImage(jpeg(2000, 500)); assert.equal(j.format, 'jpeg'); assert.equal(j.height, 500);
  const w = inspectImage(webpX(1600, 400)); assert.equal(w.mime, 'image/webp'); assert.equal(w.width, 1600);
});

test('inspectImage : refuse SVG, texte, tampon vide et en-têtes tronqués', () => {
  assert.equal(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(inspectImage(Buffer.alloc(0)), null);
  assert.equal(inspectImage(png(1600, 400).subarray(0, 20)), null);
  assert.equal(inspectImage('pas un buffer'), null);
});

test('checkBanner : une image 1600×400 est conforme', () => {
  assert.deepEqual(checkBanner(png(1600, 400)).errors, []);
  assert.deepEqual(checkBanner(jpeg(3200, 800)).errors, []);
  assert.deepEqual(checkBanner(webpX(1200, 300)).errors, []);
});

test('checkBanner : proportions, résolution et poids sont contrôlés', () => {
  assert.match(checkBanner(png(1600, 800)).errors.join(' '), /Proportions/);
  assert.match(checkBanner(png(800, 200)).errors.join(' '), /trop faible/);
  assert.match(checkBanner(png(4000, 1000)).errors.join(' '), /trop élevée/);
  assert.match(checkBanner(png(1600, 410)).errors.join(' '), /Proportions/); // rapport 3,90 : écart 2,4 %
});

test('checkBanner : tolérance de ±2 % et fichier trop lourd', () => {
  assert.equal(checkBanner(png(1600, 396)).errors.length, 0);           // rapport 4,04 (écart 1 %)
  assert.match(checkBanner(png(1600, 380)).errors.join(' '), /Proportions/); // rapport 4,21
  assert.match(checkBanner(png(1600, 400, BANNER_REQUIREMENTS.maxBytes)).errors.join(' '), /trop lourd/);
  assert.match(checkBanner(Buffer.alloc(0)).errors.join(' '), /Aucun fichier/);
  assert.match(checkBanner(Buffer.from('GIF89a....')).errors.join(' '), /Format non reconnu/);
});

test('checkLogo : carré obligatoire, 128 à 1024 px, 512 Ko maximum', () => {
  const { checkLogo, LOGO_REQUIREMENTS } = require('../../backend/src/utils/image');
  assert.deepEqual(checkLogo(png(512, 512)).errors, []);
  assert.deepEqual(checkLogo(jpeg(128, 128)).errors, []);
  assert.match(checkLogo(png(600, 300)).errors.join(' '), /carré/);
  assert.match(checkLogo(png(64, 64)).errors.join(' '), /trop faible/);
  assert.match(checkLogo(png(2048, 2048)).errors.join(' '), /trop élevée/);
  assert.match(checkLogo(png(512, 512, LOGO_REQUIREMENTS.maxBytes)).errors.join(' '), /512 Ko/);
});

test('photo d’élève : portrait accepté, proportions extrêmes, taille et résolution refusées', () => {
  const { checkPhoto } = require('../../backend/src/utils/image');
  assert.deepEqual(checkPhoto(png(600, 800)).errors, []);
  assert.deepEqual(checkPhoto(png(300, 300)).errors, []);
  assert.ok(checkPhoto(png(300, 900)).errors.some((e) => /Proportions/.test(e)));
  assert.ok(checkPhoto(png(64, 64)).errors.some((e) => /Résolution trop faible/.test(e)));
  assert.ok(checkPhoto(png(3000, 3000)).errors.some((e) => /Résolution trop élevée/.test(e)));
  assert.ok(checkPhoto(png(600, 800, 1100 * 1024)).errors.some((e) => /trop lourd/.test(e)));
  assert.ok(checkPhoto(Buffer.from('GIF89a....')).errors.length > 0);
});
