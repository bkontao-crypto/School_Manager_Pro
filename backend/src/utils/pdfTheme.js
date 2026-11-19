// Charte graphique commune aux documents PDF (bulletins, reçus, factures) : palette, bandeau, cartes, pastilles, pied de page.

const C = {
  brand: '#1E3A8A', brandDark: '#172554', accent: '#F59E0B', ink: '#1E293B', text: '#334155', muted: '#64748B',
  zebra: '#F1F5F9', border: '#E2E8F0', panel: '#F8FAFC', track: '#E2E8F0', white: '#FFFFFF', headLight: '#BFDBFE',
  good: '#059669', info: '#2563EB', warn: '#D97706', bad: '#DC2626',
  goodLight: '#ECFDF5', goodInk: '#065F46', warnLight: '#FFFBEB', warnInk: '#92400E', badLight: '#FEF2F2', badInk: '#991B1B',
  infoLight: '#EFF6FF', infoInk: '#1E40AF'
};
const MARGIN = 40;

// Bandeau de marque en haut de page ; renvoie l'ordonnée du bas du bandeau (filet d'accent compris).
function band(pdf, { org = '', subtitle = '', title = '', titleSub = '', height = 96 } = {}) {
  const W = pdf.width; const H = pdf.height; const R = W - MARGIN;
  pdf.rect(0, H - height, W, height, { fill: C.brand });
  pdf.rect(0, H - height - 4, W, 4, { fill: C.accent });
  pdf.text(MARGIN, H - 42, org, { size: 18, bold: true, color: C.white });
  if (subtitle) pdf.text(MARGIN, H - 62, subtitle, { size: 9.5, bold: true, color: C.headLight });
  if (title) pdf.text(R, H - 42, title, { size: 13, bold: true, color: C.white, align: 'right' });
  if (titleSub) pdf.text(R, H - 62, titleSub, { size: 9.5, color: C.headLight, align: 'right' });
  return H - height - 4;
}

// Carte à bordure arrondie, filet coloré en haut, libellé, valeur et sous-titre.
function card(pdf, x, y, w, h, { color = C.brand, label = '', value = '', sub = '', valueSize = 16 } = {}) {
  pdf.rect(x, y - h, w, h, { fill: C.white, stroke: C.border, radius: 8 });
  pdf.rect(x, y - 4, w, 4, { fill: color });
  if (label) pdf.text(x + 12, y - 20, label, { size: 7, bold: true, color: C.muted });
  if (value) pdf.text(x + 12, y - 20 - valueSize - 8, value, { size: valueSize, bold: true, color });
  if (sub) pdf.text(x + 12, y - h + 10, sub, { size: 7.5, color: C.muted });
}

// Pastille colorée (fond clair, texte foncé) ; renvoie sa largeur.
function pill(pdf, x, y, label, { bg = C.infoLight, ink = C.infoInk, size = 9.5 } = {}) {
  const { textWidth } = require('./pdf');
  const w = textWidth(label, size, true) + 22;
  pdf.rect(x, y - 6, w, 20, { fill: bg, radius: 10 });
  pdf.text(x + 11, y, label, { size, bold: true, color: ink });
  return w;
}

// Pied de page sur toutes les pages : légende juridique optionnelle, filet, texte et « Page X / Y ».
function footer(pdf, { text = '', legal = [] } = {}) {
  const R = pdf.width - MARGIN; const n = pdf.pageCount;
  for (let i = 0; i < n; i++) {
    pdf.goto(i);
    legal.slice(0, 3).forEach((l, k) => pdf.text(MARGIN, 64 - k * 10, l, { size: 7.5, color: C.muted }));
    pdf.line(MARGIN, 36, R, 36, { color: C.border, width: 0.8 });
    pdf.text(MARGIN, 24, text, { size: 7.5, color: C.muted });
    pdf.text(R, 24, `Page ${i + 1} / ${n}`, { size: 7.5, bold: true, color: C.brand, align: 'right' });
  }
}

module.exports = { C, MARGIN, band, card, pill, footer };
