// Reçu de paiement (PDF A4) pour un paiement encaissé : établissement, élève, objet, mode, montant en chiffres et en lettres.

const db = require('./db');
const { Pdf, wrap } = require('./pdf');
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
  const pdf = new Pdf(); const L = 50; const R = pdf.width - 50; let y = pdf.height - 38;
  pdf.rect(0, pdf.height - 70, pdf.width, 70, { fill: 0.12 });
  pdf.text(L, y, x.school_name, { size: 16, bold: true, gray: 1 });
  pdf.text(R, y, 'REÇU DE PAIEMENT', { size: 14, bold: true, align: 'right', gray: 1 });
  pdf.text(R, y - 17, x.receipt_number || '', { size: 10, align: 'right', gray: 0.85 });
  y = pdf.height - 115;
  pdf.text(L, y, `Date : ${dateFr(x.paid_at)}`, { size: 10, gray: 0.3 }); y -= 30;
  pdf.text(L, y, 'Reçu de la part de / pour l’élève', { size: 8, gray: 0.5 }); y -= 18;
  pdf.text(L, y, `${x.first_name} ${x.last_name}`, { size: 15, bold: true }); y -= 16;
  pdf.text(L, y, `Matricule : ${x.matricule || '-'}   |   Classe : ${x.class_name || '-'}${x.school_year ? `   |   Année : ${x.school_year}` : ''}`, { size: 10, gray: 0.3 });
  y -= 32;
  const row = (k, v) => { pdf.text(L, y, k, { size: 10, gray: 0.45 }); pdf.text(L + 150, y, v, { size: 11 }); pdf.line(L, y - 7, R, y - 7, { gray: 0.88 }); y -= 24; };
  row('Objet du paiement', x.fee_type || 'Frais scolaires'); row('Mode de paiement', x.method || '-'); row('Numéro de reçu', x.receipt_number || '-');
  y -= 6;
  pdf.rect(L, y - 30, R - L, 50, { fill: 0.95, stroke: 0.75 });
  pdf.text(L + 12, y - 2, 'Montant reçu', { size: 9, gray: 0.45 }); pdf.text(R - 12, y - 14, money(x.amount), { size: 20, bold: true, align: 'right' });
  y -= 56;
  const words = amountInWords(x.amount);
  const sentence = `Arrêté le présent reçu à la somme de : ${words.charAt(0).toUpperCase()}${words.slice(1)} francs CFA.`;
  wrap(sentence, R - L, 10, false).forEach((l) => { pdf.text(L, y, l, { size: 10 }); y -= 14; });
  if (x.status === 'annule') pdf.text(L, y - 10, 'PAIEMENT ANNULÉ - ce reçu n’a plus de valeur.', { size: 11, bold: true });
  const sy = 190;
  pdf.line(R - 190, sy, R, sy, { gray: 0.3 }); pdf.text(R - 190, sy - 14, 'Cachet et signature', { size: 9, gray: 0.4 });
  pdf.text(pdf.width / 2, 30, `Document généré le ${dateFr(new Date())} - School Manager Pro`, { size: 8, align: 'center', gray: 0.55 });
  return pdf.toBuffer({ title: `Reçu ${x.receipt_number || ''}` });
}

const receiptFilename = (x) => `recu-${String(x.receipt_number || 'paiement').replace(/[^\w-]+/g, '')}.pdf`;

module.exports = { loadReceipt, renderReceipt, receiptFilename };
