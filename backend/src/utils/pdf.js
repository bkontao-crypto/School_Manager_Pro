// Générateur PDF minimal, sans dépendance : texte (Helvetica / Helvetica-Bold, WinAnsi), filets et rectangles, plusieurs pages A4.
// Les flux ne sont pas compressés (fichiers de quelques Ko, texte recherchable). Les coordonnées sont en points depuis le BAS-gauche.

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

class Pdf {
  constructor() { this.pages = []; this.width = 595.28; this.height = 841.89; this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  text(x, y, str, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    const s = clean(str); const w = textWidth(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(gray)} g ${num(px)} ${num(y)} Td (${esc(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6 } = {}) { this.cur.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); return this; }
  rect(x, y, w, h, { fill = 0.93, stroke = null } = {}) {
    this.cur.push(`${num(fill)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
    if (stroke !== null) this.cur.push(`${num(stroke)} G 0.5 w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
    return this;
  }
  toBuffer(info = {}) {
    const objs = []; // index = numéro - 1
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(''); const pagesRoot = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]));
      kids.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
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
