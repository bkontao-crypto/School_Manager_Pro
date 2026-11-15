// E-mails de la plateforme (superadmin) : état de la configuration, envoi de test, journal, relance d'un envoi,
// exécution (ou simulation) des rappels, envoi d'une facture par e-mail. Monté sous /api/platform.
// Le mot de passe SMTP n'est jamais renvoyé.

const express = require('express');
const db = require('../utils/db');
const { validate } = require('../utils/validate');
const { HttpError, wrap, invalid, pageParams } = require('../utils/http');
const { audit } = require('../utils/audit');
const { mailConfig, deliver, retry, htmlLayout } = require('../utils/mailer');
const { runReminders, tenantRecipients, fmtDate, fmtMoney } = require('../utils/reminders');
const { isUuid } = require('../utils/validate');
const { loadInvoice, invoiceAttachment } = require('../utils/invoiceData');

const router = express.Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/mail', wrap(async (req, res) => {
  const c = mailConfig();
  const s = await db.query(`SELECT status, count(*)::int AS n FROM mail_outbox GROUP BY status`);
  const stats = { sent: 0, failed: 0, skipped: 0, queued: 0 };
  s.rows.forEach((r) => { stats[r.status] = r.n; });
  const reminders = await db.query(`SELECT count(*)::int AS n FROM notification_log`);
  res.json({ data: {
    configured: c.configured,
    host: c.host || null, port: c.port, secure: c.secure, user: c.user || null, from: c.from || null, app_url: c.appUrl || null,
    scheduler: process.env.MAIL_SCHEDULER !== 'false',
    stats, reminders_sent: reminders.rows[0].n,
    message: c.configured ? null : 'Envoi d’e-mails non configuré : renseignez SMTP_HOST et MAIL_FROM dans le fichier .env puis redémarrez le serveur.'
  } });
}));

router.get('/mail/outbox', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const where = []; const params = [];
  if (['sent', 'failed', 'skipped', 'queued'].includes(req.query.status)) { params.push(req.query.status); where.push(`status = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, total] = await Promise.all([
    db.query(`SELECT m.id, m.to_email, m.subject, m.kind, m.status, m.attempts, m.error, m.created_at, m.sent_at, t.name AS tenant_name
                FROM mail_outbox m LEFT JOIN tenants t ON t.id = m.tenant_id ${w.replace(/status/g, 'm.status')}
               ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    db.query(`SELECT count(*)::int AS n FROM mail_outbox ${w}`, params)
  ]);
  res.json({ data: rows.rows, total: total.rows[0].n, limit, offset });
}));

router.post('/mail/test', wrap(async (req, res) => {
  const { values, errors } = validate(req.body, { to: { type: 'string', required: true, max: 255 } });
  if (errors.length) return invalid(res, errors);
  if (!EMAIL.test(values.to)) return invalid(res, [{ field: 'to', message: 'Adresse e-mail invalide.' }]);
  const r = await deliver({ to: values.to, subject: 'Test d’envoi — SCHOOL MANAGER PRO',
    text: 'Ce message confirme que la configuration e-mail fonctionne.',
    html: htmlLayout({ title: 'Test d’envoi', intro: 'Ce message confirme que la configuration e-mail fonctionne.', footer: 'Message de test.' }), kind: 'test' });
  await audit(req, { action: 'platform.mail_test', entity: 'mail', entityId: r.id, details: { status: r.status } });
  res.status(r.status === 'sent' ? 200 : (r.status === 'skipped' ? 503 : 502)).json({ data: r, ...(r.status !== 'sent' ? { error: r.error } : {}) });
}));

router.post('/mail/outbox/:id/retry', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await retry(req.params.id);
  if (!r) throw new HttpError(404, 'Message introuvable ou déjà envoyé.');
  res.status(r.status === 'sent' ? 200 : 502).json({ data: r });
}));

router.post('/reminders/run', wrap(async (req, res) => {
  const dryRun = !!(req.body && req.body.dry_run);
  const r = await runReminders({ dryRun });
  if (!dryRun) await audit(req, { action: 'platform.reminders_run', entity: 'mail', details: { sent: r.sent, failed: r.failed } });
  res.json({ data: r });
}));

router.post('/invoices/:id/send', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(
    `SELECT i.id, i.tenant_id, i.number, i.document_type, i.amount, i.period_start, i.period_end, i.due_date, i.status, t.name AS tenant_name
       FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.id = $1`, [req.params.id]);
  if (!r.rows.length) throw new HttpError(404, 'Facture introuvable.');
  const inv = r.rows[0];
  const { values, errors } = validate(req.body || {}, { to: { type: 'string', max: 255 } });
  if (errors.length) return invalid(res, errors);
  let to = values.to ? [values.to] : await tenantRecipients(inv.tenant_id);
  if (to.some((a) => !EMAIL.test(a))) return invalid(res, [{ field: 'to', message: 'Adresse e-mail invalide.' }]);
  if (!to.length) throw new HttpError(422, 'Aucun destinataire : renseignez l’e-mail de contact de l’établissement.');
  const issuer = (await db.query('SELECT app_name FROM platform_identity')).rows[0];
  const issuerName = (issuer && issuer.app_name) || 'SCHOOL MANAGER PRO';
  const isCredit = inv.document_type === 'credit_note';
  const label = isCredit ? 'Avoir' : 'Facture';
  const total = fmtMoney(Math.abs(inv.amount));
  const subject = `${label} ${inv.number} — ${inv.tenant_name}`;
  const intro = isCredit
    ? `Veuillez trouver l’avoir ${inv.number} d’un montant de ${total} émis par ${issuerName}.`
    : `Veuillez trouver la facture ${inv.number} d’un montant de ${total} émise par ${issuerName}${inv.due_date ? `, à régler avant le ${fmtDate(inv.due_date)}` : ''}.`;
  const rows = [['Établissement', inv.tenant_name], ['Numéro', inv.number], ['Montant TTC', total]];
  if (inv.period_start && inv.period_end) rows.push(['Période', `${fmtDate(inv.period_start)} → ${fmtDate(inv.period_end)}`]);
  const html = htmlLayout({ title: subject, intro, rows, footer: `Message de ${issuerName}. Le document est joint à ce message (PDF) ; le détail est aussi consultable dans l’application.` });
  const results = [];
  const full = await loadInvoice(inv.id);
  const attachments = full ? [invoiceAttachment(full)] : [];
  for (const addr of to) results.push(await deliver({ tenantId: inv.tenant_id, to: addr, subject, text: `${intro}\n\nLe document est joint à ce message (PDF).\n`, html, kind: 'invoice', ref: inv.number, attachments, invoiceId: inv.id }));
  const sent = results.filter((x) => x.status === 'sent').length;
  if (sent) await db.query('UPDATE subscription_invoices SET last_sent_at = now() WHERE id = $1', [inv.id]);
  await audit(req, { action: 'platform.invoice_send', entity: 'invoice', entityId: inv.id, details: { number: inv.number, sent, total: results.length } });
  const configured = mailConfig().configured;
  res.status(sent ? 200 : (configured ? 502 : 503)).json({ data: { sent, total: results.length, to, mail_configured: configured, results },
    ...(sent ? {} : { error: configured ? 'L’envoi a échoué ; consultez le journal des e-mails.' : 'Envoi d’e-mails non configuré (SMTP_HOST / MAIL_FROM).' }) });
}));

module.exports = router;
