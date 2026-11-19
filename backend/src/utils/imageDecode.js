// Préparation des logos pour les PDF, sans dépendance :
//  - JPEG : intégré tel quel (filtre DCTDecode), après lecture des dimensions et du nombre de composantes ;
//  - PNG  : décodé (filtres de ligne, palettes, 1 à 16 bits, transparence) vers RGB 8 bits + canal alpha, puis compressé ;
//  - WebP ou format non pris en charge (PNG entrelacé, CMYK…) : null, le document s'affiche alors sans logo.
// La signature binaire détermine le format, jamais l'extension ni le Content-Type.

const zlib = require('node:zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf) {
  let pos = 8; let ihdr = null; let plte = null; let trns = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], ctype: data[9], interlace: data[12] };
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!ihdr || ihdr.interlace !== 0 || !idat.length || !ihdr.width || !ihdr.height) return null;
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.ctype];
  if (!chan || ![1, 2, 4, 8, 16].includes(ihdr.depth)) return null;
  if (ihdr.ctype === 3 && !plte) return null;
  const { width: W, height: H, depth } = ihdr;
  const stride = Math.ceil((W * chan * depth) / 8); const bpp = Math.max(1, Math.ceil((chan * depth) / 8));
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < H * (stride + 1)) return null;
  const out = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride); const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0; const x = src[i];
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: return null;
      }
      row[i] = v & 0xff;
    }
  }
  // Échantillon n d'une ligne, ramené à une valeur entière (0 … 2^depth - 1, ou 0 … 255 pour 8 et 16 bits).
  const sample = (row, n) => {
    if (depth === 8) return row[n];
    if (depth === 16) return row[n * 2];
    const bit = n * depth; return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const maxv = (1 << depth) - 1; const scale = (v) => (depth < 8 ? Math.round((v * 255) / maxv) : v);
  const hasAlpha = ihdr.ctype === 4 || ihdr.ctype === 6 || (ihdr.ctype === 3 && trns);
  const rgb = Buffer.alloc(W * H * 3); const alpha = hasAlpha ? Buffer.alloc(W * H, 255) : null;
  for (let y = 0; y < H; y++) {
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < W; x++) {
      const p = y * W + x; let r; let g; let b; let a = 255;
      if (ihdr.ctype === 3) {
        const idx = sample(row, x);
        r = plte[idx * 3] || 0; g = plte[idx * 3 + 1] || 0; b = plte[idx * 3 + 2] || 0;
        if (trns && idx < trns.length) a = trns[idx];
      } else if (ihdr.ctype === 0 || ihdr.ctype === 4) {
        r = g = b = scale(sample(row, x * chan));
        if (ihdr.ctype === 4) a = sample(row, x * chan + 1);
      } else {
        r = sample(row, x * chan); g = sample(row, x * chan + 1); b = sample(row, x * chan + 2);
        if (ihdr.ctype === 6) a = sample(row, x * chan + 3);
        if (depth < 8) { r = scale(r); g = scale(g); b = scale(b); }
      }
      rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
      if (alpha) alpha[p] = a;
    }
  }
  return { kind: 'raw', width: W, height: H, rgb, alpha };
}

function jpegInfo(buf) {
  let p = 2;
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { p += m === 0xff ? 1 : 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), components: buf[p + 9] };
    }
    p += 2 + len;
  }
  return null;
}

// Image prête pour le moteur PDF, ou null.
function detectImage(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf.subarray(0, 8).equals(PNG_SIG)) return decodePng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const info = jpegInfo(buf);
    if (!info || !info.width || !info.height || (info.components !== 1 && info.components !== 3)) return null;
    return { kind: 'jpeg', data: buf, width: info.width, height: info.height, cs: info.components === 1 ? 'DeviceGray' : 'DeviceRGB' };
  }
  return null;
}

module.exports = { detectImage, decodePng, jpegInfo };
