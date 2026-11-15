// Lecture des dimensions d'une image (PNG, JPEG, WebP) sans dépendance, et contrôle des exigences
// de l'affiche d'accueil. On ne fait confiance ni à l'extension ni au Content-Type : seule la
// signature binaire compte.

const BANNER_REQUIREMENTS = Object.freeze({
  formats: ['png', 'jpeg', 'webp'],
  ratio: 4,              // largeur / hauteur
  ratioTolerance: 0.02,  // ±2 %
  minWidth: 1200,
  minHeight: 300,
  maxWidth: 3200,
  maxHeight: 800,
  maxBytes: 2 * 1024 * 1024
});

// Logo : carré, léger (affiché dans le menu et sur la page de connexion).
const LOGO_REQUIREMENTS = Object.freeze({
  formats: ['png', 'jpeg', 'webp'],
  ratio: 1,
  ratioTolerance: 0.02,
  minWidth: 128,
  minHeight: 128,
  maxWidth: 1024,
  maxHeight: 1024,
  maxBytes: 512 * 1024
});

// Photo d'élève : portrait ou carré (rapport largeur/hauteur de 0,5 à 2), le navigateur la redimensionne avant l'envoi.
const PHOTO_REQUIREMENTS = Object.freeze({
  formats: ['png', 'jpeg', 'webp'],
  ratioMin: 0.5,
  ratioMax: 2,
  minWidth: 128,
  minHeight: 128,
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 1024 * 1024
});

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function parsePng(b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 24 || !b.subarray(0, 8).equals(sig) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function parseJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function parseWebp(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { format: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function inspectImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  const info = parsePng(buf) || parseJpeg(buf) || parseWebp(buf);
  if (!info || !(info.width > 0) || !(info.height > 0)) return null;
  return { ...info, mime: MIME[info.format], bytes: buf.length };
}

// Retourne { info, errors[] } ; errors vide = image conforme. `label` : « l'affiche », « le logo »...
function checkImage(buf, req, label = 'l’image') {
  const errors = [];
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { info: null, errors: ['Aucun fichier image reçu.'] };
  const maxLabel = req.maxBytes >= 1048576 ? `${req.maxBytes / 1048576} Mo` : `${Math.round(req.maxBytes / 1024)} Ko`;
  if (buf.length > req.maxBytes) errors.push(`Fichier trop lourd (${buf.length >= 1048576 ? `${(buf.length / 1048576).toFixed(1)} Mo` : `${Math.round(buf.length / 1024)} Ko`}) : maximum ${maxLabel}.`);
  const info = inspectImage(buf);
  if (!info) { errors.push('Format non reconnu : utilisez une image PNG, JPEG ou WebP.'); return { info: null, errors }; }
  const { width: w, height: h } = info;
  if (w < req.minWidth || h < req.minHeight) errors.push(`Résolution trop faible (${w}×${h}) : minimum ${req.minWidth}×${req.minHeight} px.`);
  if (w > req.maxWidth || h > req.maxHeight) errors.push(`Résolution trop élevée (${w}×${h}) : maximum ${req.maxWidth}×${req.maxHeight} px.`);
  const ratio = w / h;
  if (req.ratioMin !== undefined) {
    if (ratio < req.ratioMin || ratio > req.ratioMax) errors.push(`Proportions incorrectes (${w}×${h}) : ${label} doit avoir un rapport largeur/hauteur entre ${req.ratioMin} et ${req.ratioMax}.`);
  } else if (Math.abs(ratio - req.ratio) / req.ratio > req.ratioTolerance) {
    const shape = req.ratio === 1 ? '1:1 (carré)' : `${req.ratio}:1`;
    errors.push(`Proportions incorrectes (${w}×${h}, rapport ${ratio.toFixed(2)}:1) : ${label} doit être au format ${shape}, tolérance ±${Math.round(req.ratioTolerance * 100)} %.`);
  }
  return { info, errors };
}

const checkBanner = (buf, req = BANNER_REQUIREMENTS) => checkImage(buf, req, 'l’affiche');
const checkPhoto = (buf, req = PHOTO_REQUIREMENTS) => checkImage(buf, req, 'la photo');
const checkLogo = (buf, req = LOGO_REQUIREMENTS) => checkImage(buf, req, 'le logo');

module.exports = { BANNER_REQUIREMENTS, LOGO_REQUIREMENTS, PHOTO_REQUIREMENTS, checkPhoto, inspectImage, checkImage, checkBanner, checkLogo };
