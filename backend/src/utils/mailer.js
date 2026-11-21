// Envoi d'e-mails avec journal (table mail_outbox). La configuration est lue à chaque appel dans l'environnement :
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true pour le port 465), SMTP_USER, SMTP_PASS, MAIL_FROM, APP_URL.
// Sans SMTP_HOST, l'envoi est désactivé : rien n'est tenté, rien ne plante, et l'écran superadmin l'indique.

const db = require('./db');
const { sendSmtp } = require('./smtp');

function mailConfig() {
  const e = process.env;
  const host = (e.SMTP_HOST || '').trim();
  const port = Number(e.SMTP_PORT) || (e.SMTP_SECURE === 'true' ? 465 : 587);
  return {
    configured: !!host && !!(e.MAIL_FROM || '').trim(),
    host, port, secure: e.SMTP_SECURE === 'true' || port === 465,
    user: e.SMTP_USER || '', pass: e.SMTP_PASS || '', from: (e.MAIL_FROM || '').trim(),
    appUrl: (e.APP_URL || '').trim().replace(/\/+$/, ''),
    rejectUnauthorized: e.SMTP_REJECT_UNAUTHORIZED !== 'false'
  };
}

const escapeHtml = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Gabarit HTML sobre commun à tous les messages.
function htmlLayout({ title, intro, rows = [], footer = '', button }) {
  const tr = rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600;color:#0f172a">${escapeHtml(v)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:18px;color:#0f172a;margin:0 0 12px">${escapeHtml(title)}</h1><p style="color:#334155;line-height:1.5;margin:0 0 16px">${escapeHtml(intro).replace(/\n/g, '<br>')}</p>
${tr ? `<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${tr}</table>` : ''}
${button ? `<p><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>` : ''}
<p style="color:#94a3b8;font-size:12px;margin:20px 0 0">${escapeHtml(footer)}</p></div></body></html>`;
}

// Envoie un message et le consigne. Ne lève jamais : retourne { status: 'sent' | 'failed' | 'skipped', id, error? }.
// attachments : [{ filename, contentType, content }] ; invoiceId : permet de régénérer la facture PDF lors d'un nouvel essai.
async function deliver({ tenantId = null, to, subject, text, html, kind = 'other', ref = null, attachments = [], invoiceId = null }) {
  const cfg = mailConfig();
  const ins = await db.query(
    `INSERT INTO mail_outbox (tenant_id, to_email, subject, body_text, body_html, kind, ref, status, attachment_name, invoice_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [tenantId, String(to).slice(0, 255), String(subject).slice(0, 300), text || '', html || null, kind, ref, cfg.configured ? 'queued' : 'skipped', attachments[0] ? String(attachments[0].filename).slice(0, 150) : null, invoiceId]);
  const id = ins.rows[0].id;
  if (!cfg.configured) {
    await db.query(`UPDATE mail_outbox SET error = 'Envoi d’e-mails non configuré (SMTP_HOST / MAIL_FROM).' WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [id, tenantId]);
    return { status: 'skipped', id, error: 'Envoi d’e-mails non configuré.' };
  }
  try {
    await sendSmtp({ ...cfg, to, subject, text, html, attachments });
    await db.query(`UPDATE mail_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), error = NULL WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [id, tenantId]);
    return { status: 'sent', id };
  } catch (e) {
    await db.query(`UPDATE mail_outbox SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1 AND tenant_id IS NOT DISTINCT FROM $3`, [id, String(e.message).slice(0, 300), tenantId]);
    return { status: 'failed', id, error: e.message };
  }
}

// Nouvel essai d'un message en échec (même ligne du journal).
async function retry(id) {
  const cfg = mailConfig();
  const r = await db.query(`SELECT id, tenant_id, to_email, subject, body_text, body_html, invoice_id, kind, ref FROM mail_outbox WHERE id = $1 AND status IN ('failed', 'skipped')`, [id]);
  if (!r.rows.length) return null;
  if (!cfg.configured) return { status: 'skipped', error: 'Envoi d’e-mails non configuré.' };
  const m = r.rows[0];
  try {
    let attachments = [];
    if (m.invoice_id) { const inv = await require('./invoiceData').loadInvoice(m.invoice_id); if (inv) attachments = [require('./invoiceData').invoiceAttachment(inv)]; }
    if (m.kind === 'family_invoice' && m.ref) {
      // Facture familiale : pièce jointe régénérée à partir de l'état actuel de la facture ; une facture annulée n'est pas envoyée.
      const fam = require('./familyInvoicePdf');
      const x = await fam.loadFamilyInvoice(m.tenant_id, m.ref);
      if (!x) return { status: 'skipped', error: 'Facture introuvable.' };
      if (x.status !== 'emise') return { status: 'skipped', error: 'Facture annulée : envoi annulé.' };
      attachments = [{ filename: fam.invoiceFilename(x), contentType: 'application/pdf', content: fam.renderFamilyInvoice(x) }];
    }
    await sendSmtp({ ...cfg, to: m.to_email, subject: m.subject, text: m.body_text, html: m.body_html, attachments });
    await db.query(`UPDATE mail_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), error = NULL WHERE id = $1`, [id]);
    return { status: 'sent' };
  } catch (e) {
    await db.query(`UPDATE mail_outbox SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [id, String(e.message).slice(0, 300)]);
    return { status: 'failed', error: e.message };
  }
}

module.exports = { mailConfig, deliver, retry, htmlLayout, escapeHtml };
