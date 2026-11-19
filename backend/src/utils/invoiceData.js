// Facture d'abonnement : lecture complète (établissement, émetteur, réglages) et rendu PDF, partagés par l'écran superadmin,
// le téléchargement et l'envoi par e-mail.

const db = require('./db');
const { Pdf, wrap, textWidth } = require('./pdf');
const { C, MARGIN, band, pill, footer } = require('./pdfTheme');
const { loadPlatformLogo } = require('./brandLogo');

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
  return { ...inv, logo: await loadPlatformLogo(), tenant: t.rows[0] || {}, issuer: { app_name: iss.app_name || 'SCHOOL MANAGER PRO', slogan: iss.slogan || null, legal_details: m.legal_details || '', payment_instructions: m.payment_instructions || '' } };
}

const money = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))).replace(/[  ]/g, ' ')} F CFA`;
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const METHODS = { cash: 'Espèces', transfer: 'Virement', mobile_money: 'Mobile money', cheque: 'Chèque', card: 'Carte' };

function renderInvoicePdf(inv) {
  const pdf = new Pdf(); const L = MARGIN; const R = pdf.width - MARGIN; const CW = R - L;
  const credit = inv.document_type === 'credit_note'; const iss = inv.issuer; const t = inv.tenant || {};
  const docTitle = credit ? 'AVOIR' : 'FACTURE';
  let y = band(pdf, { org: iss.app_name, subtitle: iss.slogan || 'Abonnement plateforme', title: docTitle, titleSub: inv.number, logo: inv.logo }) - 28;

  // Client et dates
  const half = (CW - 12) / 2; const ch = 104; const x2 = L + half + 12;
  pdf.rect(L, y - ch, half, ch, { fill: C.panel, stroke: C.border, radius: 8 });
  pdf.text(L + 14, y - 20, 'FACTURÉ À', { size: 7, bold: true, color: C.muted });
  pdf.text(L + 14, y - 38, inv.tenant_name || '', { size: 12, bold: true, color: C.brandDark });
  [t.city, t.contact_name, t.contact_email, t.contact_phone].filter(Boolean).slice(0, 4).forEach((l, k) => pdf.text(L + 14, y - 54 - k * 12, l, { size: 8.5, color: C.muted }));
  pdf.rect(x2, y - ch, half, ch, { fill: C.panel, stroke: C.border, radius: 8 });
  pdf.text(x2 + 14, y - 20, 'DATES', { size: 7, bold: true, color: C.muted });
  pdf.text(x2 + 14, y - 38, `Émission : ${dateFr(inv.created_at)}`, { size: 9.5, color: C.ink });
  pdf.text(x2 + 14, y - 54, credit ? (inv.credit_for_number ? `Sur la facture ${inv.credit_for_number}` : 'Avoir') : `Échéance : ${dateFr(inv.due_date)}`, { size: 9.5, color: C.ink });
  if (inv.status === 'paid') pdf.text(x2 + 14, y - 72, `Payée le ${dateFr(inv.paid_at)}`, { size: 9, bold: true, color: C.goodInk });
  y -= ch + 24;

  // Prestations
  pdf.rect(L, y - 22, CW, 22, { fill: C.brand });
  pdf.text(L + 12, y - 14, 'DESCRIPTION', { size: 8, bold: true, color: C.white });
  pdf.text(L + CW * 0.6, y - 14, 'PÉRIODE', { size: 8, bold: true, color: C.white });
  pdf.text(R - 12, y - 14, 'MONTANT', { size: 8, bold: true, color: C.white, align: 'right' });
  y -= 22;
  const desc = wrap(inv.description || '', CW * 0.55, 9.5, false);
  const rowH = Math.max(28, desc.length * 13 + 16);
  pdf.rect(L, y - rowH, CW, rowH, { fill: C.zebra });
  desc.forEach((l, k) => pdf.text(L + 12, y - 18 - k * 13, l, { size: 9.5, color: C.ink }));
  pdf.text(L + CW * 0.6, y - 18, `${dateFr(inv.period_start)} - ${dateFr(inv.period_end)}`, { size: 9, color: C.text });
  pdf.text(R - 12, y - 18, money(Math.abs(credit ? inv.amount : inv.subtotal)), { size: 9.5, bold: true, color: C.ink, align: 'right' });
  y -= rowH + 20;
  const tableEnd = y;

  // Statut (gauche)
  const status = credit ? { label: 'AVOIR', bg: C.infoLight, ink: C.infoInk }
    : inv.status === 'paid' ? { label: 'PAYÉE', bg: C.goodLight, ink: C.goodInk }
      : inv.status === 'cancelled' ? { label: 'ANNULÉE', bg: C.badLight, ink: C.badInk }
        : { label: 'EN ATTENTE DE RÈGLEMENT', bg: C.warnLight, ink: C.warnInk };
  pill(pdf, L, y - 4, status.label, { bg: status.bg, ink: status.ink });
  if (inv.status === 'paid') {
    const mode = METHODS[inv.payment_method] || inv.payment_method || 'mode non précisé';
    pdf.text(L, y - 30, `Mode : ${mode}${inv.payment_ref ? ` (réf. ${inv.payment_ref})` : ''}`, { size: 9, color: C.text });
  }

  // Totaux (droite)
  const bx = R - 230; let ty = y;
  const tRow = (label, value) => { pdf.text(bx + 8, ty, label, { size: 9.5, color: C.muted }); pdf.text(R - 8, ty, value, { size: 9.5, color: C.ink, align: 'right' }); ty -= 16; };
  if (!credit) {
    if (inv.discount_amount > 0 || inv.tax_amount > 0) tRow('Sous-total HT', money(inv.subtotal));
    if (inv.discount_amount > 0) tRow('Remise', `- ${money(inv.discount_amount)}`);
    if (inv.tax_amount > 0) tRow(`TVA ${String(inv.tax_rate).replace('.', ',')} %`, money(inv.tax_amount));
  }
  pdf.rect(bx, ty - 30, 230, 30, { fill: C.brand, radius: 6 });
  pdf.text(bx + 10, ty - 19, credit ? 'Total de l’avoir' : 'Total TTC', { size: 9.5, bold: true, color: C.white });
  pdf.text(R - 10, ty - 20, money(Math.abs(inv.amount)), { size: 12, bold: true, color: C.white, align: 'right' });
  ty -= 38;
  if (inv.credited > 0) {
    tRow('Avoirs émis', `- ${money(Math.abs(inv.credited))}`);
    tRow('Net à régler', money(Math.abs(inv.amount) - Math.abs(inv.credited)));
  }
  y = Math.min(tableEnd, ty) - 24;

  // Modalités de paiement
  if (!credit && iss.payment_instructions) {
    const lines = wrap(iss.payment_instructions, CW - 28, 9, false).slice(0, 6);
    const bh = 30 + lines.length * 12;
    pdf.rect(L, y - bh, CW, bh, { fill: C.infoLight, radius: 8 });
    pdf.text(L + 14, y - 18, 'MODALITÉS DE PAIEMENT', { size: 7.5, bold: true, color: C.infoInk });
    lines.forEach((l, k) => pdf.text(L + 14, y - 34 - k * 12, l, { size: 9, color: C.text }));
    y -= bh + 16;
  }
  if (inv.notes) {
    wrap(inv.notes, CW, 9, false).slice(0, 5).forEach((l) => { pdf.text(L, y, l, { size: 9, color: C.muted }); y -= 12; });
  }

  // Mentions légales (au pied, au-dessus du filet)
  const legal = iss.legal_details ? wrap(iss.legal_details, CW, 7.5, false) : [];
  footer(pdf, { text: `${iss.app_name} · ${docTitle.toLowerCase()} ${inv.number} · Généré le ${new Date().toISOString().slice(0, 10).split('-').reverse().join('/')} · School Manager Pro`, legal: legal.slice(0, 3).reverse() });
  return pdf.toBuffer({ title: `${credit ? 'Avoir' : 'Facture'} ${inv.number}` });
}

const invoiceFilename = (inv) => `${inv.document_type === 'credit_note' ? 'avoir' : 'facture'}-${String(inv.number).replace(/[^\w-]+/g, '')}.pdf`;
const invoiceAttachment = (inv) => ({ filename: invoiceFilename(inv), contentType: 'application/pdf', content: renderInvoicePdf(inv) });

module.exports = { loadInvoice, renderInvoicePdf, invoiceFilename, invoiceAttachment };
