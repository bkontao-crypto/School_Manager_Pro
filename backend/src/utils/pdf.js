const zlib = require('node:zlib');
// Générateur PDF sans dépendance : texte (Helvetica / Helvetica-Bold, WinAnsi), couleurs (gris, « #rrggbb » ou [r,g,b]),
// rectangles arrondis, tracés, polygones, cercles, plusieurs pages A4. Flux compressés (FlateDecode), texte recherchable.
// Les coordonnées sont en points depuis le BAS-gauche.

const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const REPLACE = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', 'œ': 'oe', 'Œ': 'OE', '€': 'EUR', ' ': ' ', ' ': ' ' };
function clean(str) {
  return String(str === null || str === undefined ? '' : str).replace(/[^\x00-\xff]/g, (c) => (REPLACE[c] !== undefined ? REPLACE[c] : '?')).replace(/[\x00-\x1f]/g, ' ');
}
function textWidth(str, size, bold) {
  const t = bold ? WB : W; let w = 0;
  for (const ch of clean(str)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32] : 556; }
  return (w * size) / 1000;
}
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n) => (Math.round(n * 100) / 100).toString();
const num3 = (n) => (Math.round(n * 1000) / 1000).toString();

// Couleur : nombre = niveau de gris (0 noir … 1 blanc) ; « #rrggbb » ; [r, g, b] en 0-255.
function colorOp(c, stroke = false) {
  if (typeof c === 'number') return `${num3(c)} ${stroke ? 'G' : 'g'}`;
  let rgb;
  if (typeof c === 'string') { const h = c.replace('#', ''); rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); } else rgb = c.map((v) => v / 255);
  return `${rgb.map(num3).join(' ')} ${stroke ? 'RG' : 'rg'}`;
}

function wrap(str, width, size, bold) {
  const out = [];
  for (const para of clean(str).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && textWidth(test, size, bold) > width) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

// Chemin d'un rectangle, éventuellement aux coins arrondis (courbes de Bézier).
function rectPath(x, y, w, h, r = 0) {
  if (!r) return `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`;
  r = Math.min(r, w / 2, h / 2); const k = 0.5523 * r;
  const p = [
    `${num(x + r)} ${num(y)} m`, `${num(x + w - r)} ${num(y)} l`,
    `${num(x + w - r + k)} ${num(y)} ${num(x + w)} ${num(y + r - k)} ${num(x + w)} ${num(y + r)} c`,
    `${num(x + w)} ${num(y + h - r)} l`,
    `${num(x + w)} ${num(y + h - r + k)} ${num(x + w - r + k)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)} c`,
    `${num(x + r)} ${num(y + h)} l`,
    `${num(x + r - k)} ${num(y + h)} ${num(x)} ${num(y + h - r + k)} ${num(x)} ${num(y + h - r)} c`,
    `${num(x)} ${num(y + r)} l`,
    `${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c h`
  ];
  return p.join(' ');
}

class Pdf {
  constructor() { this.pages = []; this.images = []; this.width = 595.28; this.height = 841.89; this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  // Revient à une page existante (pieds de page écrits une fois le nombre de pages connu).
  goto(index) { this.cur = this.pages[index]; return this; }
  get pageCount() { return this.pages.length; }
  text(x, y, str, { size = 10, bold = false, align = 'left', gray = 0, color } = {}) {
    const s = clean(str); const w = textWidth(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${colorOp(color !== undefined ? color : gray)} ${num(px)} ${num(y)} Td (${esc(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6, color } = {}) {
    this.cur.push(`${colorOp(color !== undefined ? color : gray, true)} ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); return this;
  }
  // Rectangle plein et/ou contour ; fill = null pour pas de remplissage ; radius = coins arrondis.
  rect(x, y, w, h, { fill = 0.93, stroke = null, radius = 0, strokeWidth = 0.5 } = {}) {
    const path = rectPath(x, y, w, h, radius);
    if (fill !== null && stroke !== null) {
      this.cur.push(`${colorOp(fill)} ${colorOp(stroke, true)} ${num(strokeWidth)} w ${path} B`);
    } else if (fill !== null) {
      this.cur.push(`${colorOp(fill)} ${path} f`);
    } else if (stroke !== null) {
      this.cur.push(`${colorOp(stroke, true)} ${num(strokeWidth)} w ${path} S`);
    }
    return this;
  }
  // Ligne brisée : points [[x, y], …].
  // Image (voir imageDecode.js) placée dans le rectangle (x, y) — coin bas-gauche — largeur × hauteur.
  image(x, y, w, h, img) {
    if (!img) return this;
    this.images.push(img);
    this.cur.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im${this.images.length} Do Q`);
    return this;
  }
  polyline(points, { color = 0, width = 1 } = {}) {
    const [first, ...rest] = points;
    const d = [`${num(first[0])} ${num(first[1])} m`, ...rest.map(([x, y]) => `${num(x)} ${num(y)} l`)].join(' ');
    this.cur.push(`${colorOp(color, true)} ${num(width)} w ${d} S`); return this;
  }
  polygon(points, { fill = 0.9 } = {}) {
    const [first, ...rest] = points;
    const d = [`${num(first[0])} ${num(first[1])} m`, ...rest.map(([x, y]) => `${num(x)} ${num(y)} l`)].join(' ');
    this.cur.push(`${colorOp(fill)} ${d} h f`); return this;
  }
  circle(cx, cy, r, { fill = 0.9, stroke = null, strokeWidth = 0.5 } = {}) {
    const k = 0.5523 * r;
    const d = [
      `${num(cx + r)} ${num(cy)} m`,
      `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c`,
      `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c`,
      `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c`,
      `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h`
    ].join(' ');
    if (stroke !== null) this.cur.push(`${colorOp(fill)} ${colorOp(stroke, true)} ${num(strokeWidth)} w ${d} B`);
    else this.cur.push(`${colorOp(fill)} ${d} f`);
    return this;
  }
  toBuffer(info = {}) {
    const objs = []; // index = numéro - 1
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(''); const pagesRoot = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const streamObj = (dict, content) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream')]);
    const imgIds = this.images.map((img) => {
      if (img.kind === 'jpeg') {
        return add(streamObj(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.cs} /BitsPerComponent 8 /Filter /DCTDecode`, img.data));
      }
      const dims = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`;
      const smask = img.alpha ? add(streamObj(`${dims} /ColorSpace /DeviceGray /Filter /FlateDecode`, zlib.deflateSync(img.alpha))) : null;
      return add(streamObj(`${dims} /ColorSpace /DeviceRGB /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''}`, zlib.deflateSync(img.rgb)));
    });
    const xobjects = this.images.length ? ` /XObject << ${this.images.map((_, i) => `/Im${i + 1} ${imgIds[i]} 0 R`).join(' ')} >>` : '';
    const kids = [];
    for (const ops of this.pages) {
      const content = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, Buffer.from('\nendstream')]));
      kids.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobjects} >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objs[pagesRoot - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const infoId = add(`<< /Title (${esc(clean(info.title || ''))}) /Producer (School Manager Pro) >>`);
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offsets = []; let pos = parts[0].length;
    objs.forEach((body, i) => {
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n')]);
      offsets.push(pos); pos += b.length; parts.push(b);
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}

module.exports = { Pdf, textWidth, wrap, clean };
