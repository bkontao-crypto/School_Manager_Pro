// Communication avec les parents : message groupé par SMS, WhatsApp et/ou e-mail, historique, alerte automatique d'absence.
// GET /channels · GET /preview?type=&id= · GET / · POST / · GET|PUT /settings (réglages : administrateur)
// Droits : module « notifications » (lecture pour consulter, écriture pour envoyer).

const express = require('express');
const db = require('../utils/db');
const { validate, isUuid } = require('../utils/validate');
const { wrap, invalid, pageParams, HttpError } = require('../utils/http');
const { requireWrite } = require('../utils/permissions');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const notify = require('../utils/notify');

const router = express.Router();

function audienceOf(src) {
  const type = src.type || 'all';
  if (!['all', 'class', 'student'].includes(type)) throw new HttpError(400, 'Destinataires invalides.');
  if (type !== 'all' && !isUuid(src.id)) throw new HttpError(400, 'Choisissez la classe ou l’élève.');
  return { type, id: type === 'all' ? null : src.id };
}
async function labelOf(tenantId, a) {
  if (a.type === 'all') return 'Tous les parents';
  const r = a.type === 'class'
    ? await db.query('SELECT name AS l FROM classes WHERE id = $1 AND tenant_id = $2', [a.id, tenantId])
    : await db.query(`SELECT first_name || ' ' || last_name AS l FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [a.id, tenantId]);
  if (!r.rows.length) throw new HttpError(404, a.type === 'class' ? 'Classe introuvable.' : 'Élève introuvable.');
  return a.type === 'class' ? `Classe ${r.rows[0].l}` : `Parents de ${r.rows[0].l}`;
}

router.get('/channels', (req, res) => res.json({ data: notify.channelStatus() }));

router.get('/preview', wrap(async (req, res) => {
  const a = audienceOf(req.query);
  const label = await labelOf(req.tenantId, a);
  const list = await notify.guardians(req.tenantId, a);
  const count = (ch) => list.filter((p) => notify.reachable(p, ch)).length;
  res.json({ data: { label, guardians: list.length, email: count('email'), sms: count('sms'), whatsapp: count('whatsapp'), max: notify.MAX_RECIPIENTS } });
}));

router.get('/', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const r = await db.query(
    `SELECT id, audience_type, audience_label, subject, body, channels, recipients, sent, failed, skipped, created_at FROM broadcasts
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [req.tenantId, limit, offset]);
  res.json({ data: r.rows });
}));

router.post('/', requireWrite('notifications'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    subject: { type: 'string', required: true, max: 200 },
    body: { type: 'text', required: true, max: 1000 }
  });
  const channels = Array.isArray(req.body.channels) ? [...new Set(req.body.channels)] : [];
  if (!channels.length || channels.some((c) => !notify.CHANNELS.includes(c))) errors.push({ field: 'channels', message: 'Choisissez au moins un canal valide.' });
  if (errors.length) return invalid(res, errors);
  const a = audienceOf(req.body.audience || {});
  const st = notify.channelStatus();
  const down = channels.filter((c) => !st[c].available);
  if (down.length) throw new HttpError(409, `Canal indisponible : ${down.map((c) => notify.CHANNEL_LABELS[c]).join(', ')}. ${st[down[0]].reason}`);
  if (channels.includes('sms') && values.body.length > notify.SMS_MAX) throw new HttpError(400, `Message trop long pour un SMS (${notify.SMS_MAX} caractères maximum).`);
  const label = await labelOf(req.tenantId, a);
  let total;
  try { total = await notify.broadcast({ tenantId: req.tenantId, audience: a, channels, subject: values.subject, body: values.body }); }
  catch (e) { if (e.status === 400) throw new HttpError(400, e.message); throw e; }
  if (!total.recipients) throw new HttpError(422, 'Aucun responsable rattaché pour ces destinataires.');
  const ins = await db.query(
    `INSERT INTO broadcasts (tenant_id, created_by, audience_type, audience_id, audience_label, subject, body, channels, recipients, sent, failed, skipped)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, created_at`,
    [req.tenantId, req.user.id, a.type, a.id, label, values.subject, values.body, channels, total.recipients, total.sent, total.failed, total.skipped]);
  await audit(req, { action: 'broadcast.send', entity: 'broadcast', entityId: ins.rows[0].id, details: { audience: a.type, channels, ...total } });
  res.status(201).json({ data: { id: ins.rows[0].id, ...total } });
}));

router.get('/unpaid', wrap(async (req, res) => {
  const list = await notify.unpaidPreview(req.tenantId);
  res.json({ data: { parents: list.length, total: list.reduce((a, x) => a + x.amount, 0), rows: list.slice(0, 200) } });
}));
router.post('/unpaid', requireWrite('notifications'), wrap(async (req, res) => {
  const channels = Array.isArray(req.body.channels) ? [...new Set(req.body.channels)] : [];
  if (!channels.length || channels.some((c) => !notify.CHANNELS.includes(c))) return invalid(res, [{ field: 'channels', message: 'Choisissez au moins un canal valide.' }]);
  const st = notify.channelStatus(); const down = channels.filter((c) => !st[c].available);
  if (down.length) throw new HttpError(409, `Canal indisponible : ${down.map((c) => notify.CHANNEL_LABELS[c]).join(', ')}. ${st[down[0]].reason}`);
  let total;
  try { total = await notify.remindUnpaidNow({ tenantId: req.tenantId, channels }); } catch (e) { if (e.status === 400) throw new HttpError(400, e.message); throw e; }
  if (!total.recipients) throw new HttpError(422, 'Aucun impayé à relancer.');
  const ins = await db.query(
    `INSERT INTO broadcasts (tenant_id, created_by, audience_type, audience_label, subject, body, channels, recipients, sent, failed, skipped)
     VALUES ($1, $2, 'unpaid', 'Parents avec impayés', 'Rappel de paiement', 'Rappel d’impayés (montants par enfant)', $3, $4, $5, $6, $7) RETURNING id`,
    [req.tenantId, req.user.id, channels, total.recipients, total.sent, total.failed, total.skipped]);
  await audit(req, { action: 'broadcast.unpaid', entity: 'broadcast', entityId: ins.rows[0].id, details: { channels, ...total } });
  res.status(201).json({ data: { id: ins.rows[0].id, ...total } });
}));

router.get('/settings', wrap(async (req, res) => {
  const r = await db.query('SELECT absence_channels, unpaid_channels, unpaid_after_days FROM notification_settings WHERE tenant_id = $1', [req.tenantId]);
  const row = r.rows[0] || {};
  res.json({ data: { absence_channels: row.absence_channels || [], unpaid_channels: row.unpaid_channels || [], unpaid_after_days: row.unpaid_after_days || 7, channels: notify.channelStatus() } });
}));
router.put('/settings', requireRole('admin'), wrap(async (req, res) => {
  const list = (v) => (Array.isArray(v) ? [...new Set(v)] : null);
  const cur = (await db.query('SELECT absence_channels, unpaid_channels, unpaid_after_days FROM notification_settings WHERE tenant_id = $1', [req.tenantId])).rows[0] || { absence_channels: [], unpaid_channels: [], unpaid_after_days: 7 };
  const next = { absence_channels: req.body.absence_channels === undefined ? cur.absence_channels : list(req.body.absence_channels), unpaid_channels: req.body.unpaid_channels === undefined ? cur.unpaid_channels : list(req.body.unpaid_channels), unpaid_after_days: req.body.unpaid_after_days === undefined ? cur.unpaid_after_days : Number(req.body.unpaid_after_days) };
  const errors = [];
  for (const k of ['absence_channels', 'unpaid_channels']) if (!next[k] || next[k].some((c) => !notify.CHANNELS.includes(c))) errors.push({ field: k, message: 'Canaux invalides.' });
  if (!Number.isInteger(next.unpaid_after_days) || next.unpaid_after_days < 1 || next.unpaid_after_days > 90) errors.push({ field: 'unpaid_after_days', message: 'Entre 1 et 90 jours.' });
  if (errors.length) return invalid(res, errors);
  await db.query(
    `INSERT INTO notification_settings (tenant_id, absence_channels, unpaid_channels, unpaid_after_days) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET absence_channels = EXCLUDED.absence_channels, unpaid_channels = EXCLUDED.unpaid_channels, unpaid_after_days = EXCLUDED.unpaid_after_days, updated_at = now()`,
    [req.tenantId, next.absence_channels, next.unpaid_channels, next.unpaid_after_days]);
  await audit(req, { action: 'notification.settings', entity: 'tenant', entityId: req.tenantId, details: next });
  res.json({ data: next });
}));

module.exports = router;
