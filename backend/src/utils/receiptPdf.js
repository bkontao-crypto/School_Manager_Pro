// Reçu de paiement (PDF A4) pour un paiement encaissé : établissement, élève, objet, mode, montant en chiffres et en lettres.

const db = require('./db');
const { Pdf, wrap, textWidth } = require('./pdf');
const { C, MARGIN, band, pill, footer } = require('./pdfTheme');
const { amountInWords } = require('./amountWords');

const money = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))).replace(/[  ]/g, ' ')} F CFA`;
const dateFr = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/') : '-');

// null si le paiement n'existe pas dans cet établissement.
async function loadReceipt(tenantId, paymentId) {
  const r = await db.query(
    `SELECT p.id, p.student_id, p.amount::float8 AS amount, p.fee_type, p.method, p.status, p.receipt_number, p.paid_at,
            s.first_name, s.last_name, s.matricule, c.name AS class_name, c.school_year, t.name AS school_name
       FROM payments p JOIN students s ON s.tenant_id = p.tenant_id AND s.id = p.student_id
       LEFT JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id JOIN tenants t ON t.id = p.tenant_id
      WHERE p.id = $1 AND p.tenant_id = $2`, [paymentId, tenantId]);
  return r.rows[0] || null;
}

function renderReceipt(x) {
  const pdf = new Pdf(); const L = MARGIN; const R = pdf.width - MARGIN; const CW = R - L; const annule = x.status === 'annule';
  const school = x.school_name || 'Établissement';
  let y = band(pdf, { org: school, subtitle: 'Établissement scolaire', title: 'REÇU DE PAIEMENT', titleSub: x.receipt_number || '' }) - 28;

  // Carte élève
  pdf.rect(L, y - 56, CW, 56, { fill: C.panel, stroke: C.border, radius: 8 });
  pdf.text(L + 16, y - 22, `${x.first_name} ${x.last_name}`, { size: 14, bold: true, color: C.brandDark });
  pdf.text(L + 16, y - 39, `Matricule : ${x.matricule || '-'}   |   Classe : ${x.class_name || '-'}${x.school_year ? `   |   Année : ${x.school_year}` : ''}`, { size: 9, color: C.muted });
  pdf.text(R - 16, y - 22, `Date : ${dateFr(x.paid_at)}`, { size: 9, bold: true, color: C.text, align: 'right' });
  y -= 56 + 20;

  // Montant encaissé (carte colorée) et statut
  const ch = 92; const tone = annule ? { bg: C.badLight, edge: '#FECACA', bar: C.bad, ink: C.bad } : { bg: C.goodLight, edge: '#A7F3D0', bar: C.good, ink: C.goodInk };
  pdf.rect(L, y - ch, CW, ch, { fill: tone.bg, stroke: tone.edge, radius: 10 });
  pdf.rect(L, y - ch + 10, 5, ch - 20, { fill: tone.bar });
  pdf.text(L + 22, y - 26, 'MONTANT REÇU', { size: 8, bold: true, color: C.muted });
  pdf.text(L + 22, y - 64, money(x.amount), { size: 26, bold: true, color: tone.ink });
  const label = annule ? 'ANNULÉ' : 'ENCAISSÉ';
  const pw = textWidth(label, 9.5, true) + 22;
  pill(pdf, R - 16 - pw, y - 26, label, annule ? { bg: C.badLight, ink: C.badInk } : { bg: C.goodLight, ink: C.goodInk });
  y -= ch + 24;

  // Détails du paiement
  const row = (k, v) => { pdf.text(L + 4, y, k, { size: 9.5, color: C.muted }); pdf.text(L + 170, y, v, { size: 10.5, color: C.ink }); pdf.line(L, y - 9, R, y - 9, { color: C.border, width: 0.6 }); y -= 26; };
  row('Objet du paiement', x.fee_type || 'Frais scolaires');
  row('Mode de paiement', x.method || '-');
  row('Numéro de reçu', x.receipt_number || '-');
  y -= 14;

  // Montant en lettres
  const words = amountInWords(x.amount);
  pdf.text(L, y, 'ARRÊTÉ LE PRÉSENT REÇU À LA SOMME DE', { size: 7.5, bold: true, color: C.muted }); y -= 16;
  wrap(`${words.charAt(0).toUpperCase()}${words.slice(1)} francs CFA.`, CW, 11, true).forEach((l) => { pdf.text(L, y, l, { size: 11, bold: true, color: C.ink }); y -= 15; });
  if (annule) { y -= 8; pdf.text(L, y, 'PAIEMENT ANNULÉ : ce reçu n’a plus de valeur.', { size: 10, bold: true, color: C.bad }); }

  // Signature
  const sy = 130;
  pdf.line(R - 180, sy, R, sy, { color: C.muted, width: 0.6 });
  pdf.text(R - 180, sy - 13, 'Cachet et signature', { size: 8.5, color: C.muted });

  footer(pdf, { text: `${school} · Reçu ${x.receipt_number || ''} · Généré le ${dateFr(new Date())} · School Manager Pro` });
  return pdf.toBuffer({ title: `Reçu ${x.receipt_number || ''}` });
}

const receiptFilename = (x) => `recu-${String(x.receipt_number || 'paiement').replace(/[^\w-]+/g, '')}.pdf`;

module.exports = { loadReceipt, renderReceipt, receiptFilename };
