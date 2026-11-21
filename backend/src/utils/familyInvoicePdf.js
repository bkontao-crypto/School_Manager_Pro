// Facture familiale (PDF A4) : établissement, élève, lignes, total, paiements affectés, solde dû.
// Mêmes gabarit et charte que le reçu de paiement.

const db = require('./db');
const { Pdf, wrap } = require('./pdf');
const { C, MARGIN, band, pill, footer } = require('./pdfTheme');
const { loadTenantLogo } = require('./brandLogo');
const { amountInWords } = require('./amountWords');
const { htmlLayout } = require('./mailer');

const money = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))).replace(/[  ]/g, ' ')} F CFA`;
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');

// null si la facture n'existe pas dans cet établissement.
async function loadFamilyInvoice(tenantId, invoiceId) {
  const r = await db.query(
    `SELECT i.id, i.student_id, i.invoice_number, i.issued_on::text AS issued_on, i.due_on::text AS due_on,
            i.total::float8 AS total, i.status, i.note,
            s.first_name, s.last_name, s.matricule, c.name AS class_name, t.name AS school_name,
            COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id), 0)::float8 AS paid
       FROM student_invoices i
       JOIN students s ON s.id = i.student_id AND s.tenant_id = i.tenant_id
       LEFT JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2`, [invoiceId, tenantId]);
  if (!r.rows[0]) return null;
  const x = r.rows[0];
  const [items, allocations, logo] = await Promise.all([
    db.query(`SELECT label, quantity, unit_amount::float8 AS unit_amount, amount::float8 AS amount
                FROM invoice_items WHERE invoice_id = $1 ORDER BY position, label`, [invoiceId]),
    db.query(`SELECT p.receipt_number, p.paid_at, a.amount::float8 AS amount
                FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
               WHERE a.invoice_id = $1 ORDER BY p.paid_at`, [invoiceId]),
    loadTenantLogo(tenantId)
  ]);
  return { ...x, balance: Math.round((x.total - x.paid) * 100) / 100, items: items.rows, allocations: allocations.rows, logo };
}

// Adresses des responsables de l'élève ayant un e-mail (dédoublonnées).
async function invoiceRecipients(tenantId, studentId) {
  const r = await db.query(
    `SELECT DISTINCT p.email FROM student_parents sp JOIN parents p ON p.id = sp.parent_id
      WHERE sp.student_id = $1 AND p.tenant_id = $2 AND p.email IS NOT NULL AND p.email <> ''`, [studentId, tenantId]);
  return r.rows.map((row) => row.email);
}

function renderFamilyInvoice(x) {
  const pdf = new Pdf(); const L = MARGIN; const R = pdf.width - MARGIN; const CW = R - L;
  const annulee = x.status === 'annulee';
  const soldee = !annulee && x.balance <= 0;
  const school = x.school_name || 'Établissement';
  let y = band(pdf, { org: school, subtitle: 'Établissement scolaire', title: 'FACTURE', titleSub: x.invoice_number || '', logo: x.logo }) - 28;

  // Carte élève
  pdf.rect(L, y - 56, CW, 56, { fill: C.panel, stroke: C.border, radius: 8 });
  pdf.text(L + 16, y - 22, `${x.first_name} ${x.last_name}`, { size: 14, bold: true, color: C.brandDark });
  pdf.text(L + 16, y - 39, `Matricule : ${x.matricule || '-'}   |   Classe : ${x.class_name || '-'}`, { size: 9, color: C.muted });
  pdf.text(R - 16, y - 22, `Émise le : ${dateFr(x.issued_on)}`, { size: 9, bold: true, color: C.text, align: 'right' });
  if (x.due_on) pdf.text(R - 16, y - 39, `Échéance : ${dateFr(x.due_on)}`, { size: 9, color: C.muted, align: 'right' });
  y -= 56 + 22;

  // Entête du tableau des lignes
  const cQty = R - 210; const cUnit = R - 140;
  pdf.rect(L, y - 20, CW, 20, { fill: C.zebra });
  pdf.text(L + 10, y - 13, 'DÉSIGNATION', { size: 8, bold: true, color: C.muted });
  pdf.text(cQty, y - 13, 'QTÉ', { size: 8, bold: true, color: C.muted });
  pdf.text(cUnit, y - 13, 'UNITAIRE', { size: 8, bold: true, color: C.muted });
  pdf.text(R - 10, y - 13, 'MONTANT', { size: 8, bold: true, color: C.muted, align: 'right' });
  y -= 20;

  // Lignes
  for (const it of x.items) {
    pdf.text(L + 10, y - 14, String(it.label).slice(0, 70), { size: 10, color: C.ink });
    pdf.text(cQty, y - 14, String(it.quantity), { size: 10, color: C.text });
    pdf.text(cUnit, y - 14, money(it.unit_amount), { size: 9.5, color: C.text });
    pdf.text(R - 10, y - 14, money(it.amount), { size: 10, bold: true, color: C.ink, align: 'right' });
    pdf.line(L, y - 20, R, y - 20, { color: C.border, width: 0.6 });
    y -= 22;
  }
  y -= 16;

  // Totaux (bloc à droite)
  const tot = (k, v, opts = {}) => { pdf.text(R - 190, y, k, { size: 9.5, color: C.muted }); pdf.text(R - 10, y, v, { size: opts.size || 10.5, bold: !!opts.bold, color: opts.color || C.ink, align: 'right' }); y -= 20; };
  tot('Total de la facture', money(x.total));
  tot('Montant payé', money(x.paid));
  tot('Solde dû', money(x.balance), { bold: true, size: 12, color: soldee ? C.good : C.brandDark });
  y -= 6;

  // Statut
  const label = annulee ? 'ANNULÉE' : soldee ? 'SOLDÉE' : x.paid > 0 ? 'PARTIELLE' : 'IMPAYÉE';
  const tone = annulee ? { bg: C.badLight, ink: C.badInk } : soldee ? { bg: C.goodLight, ink: C.goodInk } : { bg: C.warnLight, ink: C.warnInk };
  pill(pdf, L, y, label, tone);
  y -= 34;

  // Paiements affectés
  pdf.text(L, y, 'PAIEMENTS AFFECTÉS', { size: 7.5, bold: true, color: C.muted }); y -= 16;
  if (!x.allocations.length) { pdf.text(L, y, 'Aucun paiement affecté à cette facture.', { size: 10, color: C.muted }); y -= 16; }
  for (const a of x.allocations) {
    pdf.text(L + 4, y, `Reçu ${a.receipt_number || '-'} du ${dateFr(a.paid_at)}`, { size: 10, color: C.text });
    pdf.text(R - 10, y, money(a.amount), { size: 10, bold: true, color: C.ink, align: 'right' });
    pdf.line(L, y - 8, R, y - 8, { color: C.border, width: 0.6 });
    y -= 20;
  }
  y -= 14;

  // Montant en lettres
  pdf.text(L, y, 'ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE', { size: 7.5, bold: true, color: C.muted }); y -= 16;
  wrap(`${amountInWords(x.total).charAt(0).toUpperCase()}${amountInWords(x.total).slice(1)} francs CFA.`, CW, 11, true)
    .forEach((l) => { pdf.text(L, y, l, { size: 11, bold: true, color: C.ink }); y -= 15; });
  if (annulee) { y -= 8; pdf.text(L, y, 'FACTURE ANNULÉE : ce document n’a plus de valeur.', { size: 10, bold: true, color: C.bad }); }
  if (x.note) { y -= 14; pdf.text(L, y, String(x.note).slice(0, 180), { size: 9, color: C.muted }); }

  footer(pdf, { text: `${school} · Facture ${x.invoice_number || ''} · Généré le ${dateFr(new Date())} · School Manager Pro` });
  return pdf.toBuffer({ title: `Facture ${x.invoice_number || ''}` });
}

const invoiceFilename = (x) => `facture-${String(x.invoice_number || 'famille').replace(/[^\w-]+/g, '')}.pdf`;

// Corps d'e-mail : texte brut et HTML (gabarit commun).
function invoiceEmail(x) {
  const subject = `Facture ${x.invoice_number} — ${x.first_name} ${x.last_name}`;
  const intro = `Veuillez trouver ci-joint la facture ${x.invoice_number} concernant ${x.first_name} ${x.last_name}.`;
  const rows = [['Montant total', money(x.total)], ['Montant payé', money(x.paid)], ['Solde dû', money(x.balance)]];
  if (x.due_on) rows.push(['Échéance', dateFr(x.due_on)]);
  const text = `${intro}\n\nTotal : ${money(x.total)}\nPayé : ${money(x.paid)}\nSolde dû : ${money(x.balance)}\n\n${x.school_name || ''}`;
  const html = htmlLayout({ title: subject, intro, rows, footer: x.school_name || '' });
  return { subject, text, html };
}

module.exports = { loadFamilyInvoice, invoiceRecipients, renderFamilyInvoice, invoiceFilename, invoiceEmail, money };
