// Facture d'abonnement : lecture complète (établissement, émetteur, réglages) et rendu PDF, partagés par l'écran superadmin,
// le téléchargement et l'envoi par e-mail.

const db = require('./db');
const { Pdf, wrap } = require('./pdf');

const INVOICE_SQL = `
  SELECT i.id, i.number, i.tenant_id, t.name AS tenant_name, t.code AS tenant_code, i.plan_id, p.name AS plan_name, i.description,
         i.period_start, i.period_end, i.months, i.amount::float8 AS amount, i.status, i.due_date, i.paid_at, i.payment_method,
         i.payment_ref, i.license_extended, i.notes, i.created_at, i.document_type, i.credit_for, cf.number AS credit_for_number,
         COALESCE(i.subtotal, i.amount)::float8 AS subtotal, i.discount_amount::float8 AS discount_amount, i.tax_rate::float8 AS tax_rate,
         i.tax_amount::float8 AS tax_amount, i.last_sent_at,
         (SELECT COALESCE(sum(c.amount), 0) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued')::float8 AS credited
    FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN plans p ON p.id = i.plan_id
    LEFT JOIN subscription_invoices cf ON cf.id = i.credit_for WHERE i.id = $1`;

async function loadInvoice(id) {
  const r = await db.query(INVOICE_SQL, [id]);
  if (!r.rows.length) return null;
  const inv = r.rows[0];
  const t = await db.query('SELECT city, contact_name, contact_email, contact_phone, contract_ref FROM tenants WHERE id = $1', [inv.tenant_id]);
  const iss = (await db.query('SELECT app_name, slogan FROM platform_identity')).rows[0] || {};
  const st = await db.query(`SELECT key, value FROM platform_settings WHERE key IN ('legal_details', 'payment_instructions')`);
  const m = Object.fromEntries(st.rows.map((x) => [x.key, x.value]));
  return { ...inv, tenant: t.rows[0] || {}, issuer: { app_name: iss.app_name || 'SCHOOL MANAGER PRO', slogan: iss.slogan || null, legal_details: m.legal_details || '', payment_instructions: m.payment_instructions || '' } };
}

const money = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))).replace(/[  ]/g, ' ')} F CFA`;
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const METHODS = { cash: 'Espèces', transfer: 'Virement', mobile_money: 'Mobile money', cheque: 'Chèque', card: 'Carte' };

function renderInvoicePdf(inv) {
  const pdf = new Pdf(); const L = 50; const R = pdf.width - 50; const credit = inv.document_type === 'credit_note'; const iss = inv.issuer; const t = inv.tenant || {};
  pdf.rect(0, pdf.height - 70, pdf.width, 70, { fill: 0.12 });
  pdf.text(L, pdf.height - 38, iss.app_name, { size: 16, bold: true, gray: 1 });
  if (iss.slogan) pdf.text(L, pdf.height - 55, iss.slogan, { size: 9, gray: 0.85 });
  pdf.text(R, pdf.height - 38, credit ? 'AVOIR' : 'FACTURE', { size: 16, bold: true, align: 'right', gray: 1 });
  pdf.text(R, pdf.height - 55, inv.number, { size: 10, align: 'right', gray: 0.85 });
  let y = pdf.height - 110;
  pdf.text(L, y, 'Facturé à', { size: 8, gray: 0.5 }); pdf.text(R - 190, y, 'Dates', { size: 8, gray: 0.5 }); y -= 16;
  pdf.text(L, y, inv.tenant_name, { size: 12, bold: true });
  pdf.text(R - 190, y, `Émission : ${dateFr(inv.created_at)}`, { size: 10 }); y -= 14;
  const lines = [t.city, t.contact_name, t.contact_email, t.contact_phone].filter(Boolean);
  const dueLine = credit ? (inv.credit_for_number ? `Sur la facture ${inv.credit_for_number}` : '') : `Échéance : ${dateFr(inv.due_date)}`;
  pdf.text(R - 190, y, dueLine, { size: 10 });
  lines.forEach((l, k) => { pdf.text(L, y - k * 13, l, { size: 10, gray: 0.3 }); });
  y -= Math.max(lines.length * 13, 28) + 20;
  pdf.rect(L, y - 6, R - L, 22, { fill: 0.9 });
  pdf.text(L + 4, y, 'Description', { size: 10, bold: true }); pdf.text(L + 300, y, 'Période', { size: 10, bold: true }); pdf.text(R - 4, y, 'Montant', { size: 10, bold: true, align: 'right' });
  y -= 26;
  const desc = wrap(inv.description, 280, 10, false);
  desc.forEach((l, k) => pdf.text(L + 4, y - k * 13, l, { size: 10 }));
  pdf.text(L + 300, y, `${dateFr(inv.period_start)} - ${dateFr(inv.period_end)}`, { size: 10 });
  pdf.text(R - 4, y, money(Math.abs(credit ? inv.amount : inv.subtotal)), { size: 10, align: 'right' });
  y -= desc.length * 13 + 8; pdf.line(L, y, R, y, { gray: 0.85 }); y -= 22;
  const row = (label, value, bold = false, size = 10) => { pdf.text(R - 150, y, label, { size, bold, align: 'right' }); pdf.text(R - 4, y, value, { size, bold, align: 'right' }); y -= 16; };
  if (!credit) {
    if (inv.discount_amount > 0 || inv.tax_amount > 0) row('Sous-total HT', money(inv.subtotal));
    if (inv.discount_amount > 0) row('Remise', `- ${money(inv.discount_amount)}`);
    if (inv.tax_amount > 0) row(`TVA ${String(inv.tax_rate).replace('.', ',')} %`, money(inv.tax_amount));
  }
  y -= 4; row(credit ? 'Total de l’avoir' : 'Total TTC', money(Math.abs(inv.amount)), true, 12);
  if (inv.credited > 0) { row('Avoirs émis', `- ${money(Math.abs(inv.credited))}`); row('Net à régler', money(Math.abs(inv.amount) - Math.abs(inv.credited)), true); }
  y -= 12;
  if (inv.status === 'paid') pdf.text(L, y, `Payée le ${dateFr(inv.paid_at)} - ${METHODS[inv.payment_method] || inv.payment_method || 'mode non précisé'}${inv.payment_ref ? ` (réf. ${inv.payment_ref})` : ''}`, { size: 10, bold: true });
  else if (inv.status === 'cancelled') pdf.text(L, y, 'Facture annulée.', { size: 10, bold: true });
  else if (!credit) pdf.text(L, y, 'En attente de règlement.', { size: 10, bold: true });
  y -= 22;
  if (inv.notes) { wrap(inv.notes, R - L, 9, false).forEach((l) => { pdf.text(L, y, l, { size: 9, gray: 0.4 }); y -= 12; }); y -= 6; }
  if (!credit && iss.payment_instructions) {
    pdf.text(L, y, 'Modalités de paiement', { size: 9, bold: true, gray: 0.4 }); y -= 14;
    wrap(iss.payment_instructions, R - L, 10, false).forEach((l) => { pdf.text(L, y, l, { size: 10 }); y -= 13; }); y -= 8;
  }
  if (iss.legal_details) { pdf.line(L, 70, R, 70, { gray: 0.8 }); wrap(iss.legal_details, R - L, 8, false).slice(0, 4).forEach((l, k) => pdf.text(L, 58 - k * 10, l, { size: 8, gray: 0.5 })); }
  return pdf.toBuffer({ title: `${credit ? 'Avoir' : 'Facture'} ${inv.number}` });
}

const invoiceFilename = (inv) => `${inv.document_type === 'credit_note' ? 'avoir' : 'facture'}-${String(inv.number).replace(/[^\w-]+/g, '')}.pdf`;
const invoiceAttachment = (inv) => ({ filename: invoiceFilename(inv), contentType: 'application/pdf', content: renderInvoicePdf(inv) });

module.exports = { loadInvoice, renderInvoicePdf, invoiceFilename, invoiceAttachment };
