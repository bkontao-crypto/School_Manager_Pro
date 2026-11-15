// Notifications aux parents par SMS, WhatsApp et e-mail.
//  - SMS et WhatsApp passent par Twilio (API REST) ; le fournisseur est isolé ici pour pouvoir en brancher un autre.
//    Variables : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM (numéro ou identifiant d'expéditeur),
//    TWILIO_WHATSAPP_FROM (ex. +14155238886), TWILIO_API_BASE (tests). Sans elles, le canal est « indisponible » : rien n'est envoyé.
//  - E-mail : SMTP existant (utils/mailer).
//  - Chaque envoi est consigné ; aucune fonction d'envoi ne lève d'exception.
//  - WhatsApp : hors fenêtre de 24 h, Meta/Twilio n'acceptent que des modèles pré-approuvés ; un texte libre peut donc être refusé
//    (l'erreur est consignée). Les modèles ne sont pas gérés dans cette version.

const db = require('./db');
const { mailConfig, deliver, htmlLayout } = require('./mailer');
const { normalizePhone } = require('./phone');

const CHANNELS = ['email', 'sms', 'whatsapp'];
const CHANNEL_LABELS = { email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp' };
const MAX_RECIPIENTS = 300;
const SMS_MAX = 480;
// Plafond de SMS / WhatsApp par établissement et par jour (coût et abus) ; NOTIFY_DAILY_LIMIT, 500 par défaut, 0 = illimité.
const dailyLimit = () => { const v = Number(process.env.NOTIFY_DAILY_LIMIT); return Number.isFinite(v) && v >= 0 ? v : 500; };

function twilioConfig() {
  const e = process.env;
  const sid = (e.TWILIO_ACCOUNT_SID || '').trim(); const token = (e.TWILIO_AUTH_TOKEN || '').trim();
  return {
    sid, token, smsFrom: (e.TWILIO_SMS_FROM || '').trim(), waFrom: (e.TWILIO_WHATSAPP_FROM || '').trim(),
    base: (e.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/+$/, ''), ok: !!sid && !!token
  };
}

function channelStatus() {
  const t = twilioConfig();
  const off = 'Non configuré par la plateforme.';
  return {
    email: { available: mailConfig().configured, reason: mailConfig().configured ? null : 'Envoi d’e-mails non configuré (SMTP).' },
    sms: { available: t.ok && !!t.smsFrom, reason: t.ok && t.smsFrom ? null : off },
    whatsapp: { available: t.ok && !!t.waFrom, reason: t.ok && t.waFrom ? null : off }
  };
}

async function twilioSend(channel, to, body) {
  const t = twilioConfig();
  const from = channel === 'whatsapp' ? `whatsapp:${t.waFrom.replace(/^whatsapp:/, '')}` : t.smsFrom;
  const dest = channel === 'whatsapp' ? `whatsapp:${to}` : to;
  const res = await fetch(`${t.base}/2010-04-01/Accounts/${encodeURIComponent(t.sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${t.sid}:${t.token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: dest, From: from, Body: body }).toString(),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Fournisseur : erreur ${res.status}`);
  return data.sid || null;
}

// SMS ou WhatsApp : journalise puis envoie. Retourne { status: 'sent' | 'failed' | 'skipped', id, error? }.
async function deliverPhone({ tenantId, channel, to, body, kind = 'other', ref = null }) {
  const phone = normalizePhone(to);
  const st = channelStatus()[channel];
  const text = String(body).slice(0, channel === 'sms' ? SMS_MAX : 1000);
  let capped = false;
  if (phone && st.available && dailyLimit() > 0) {
    const used = (await db.query(`SELECT count(*)::int AS n FROM notify_outbox WHERE tenant_id = $1 AND status IN ('queued', 'sent', 'failed') AND created_at >= date_trunc('day', now())`, [tenantId])).rows[0].n;
    capped = used >= dailyLimit();
  }
  const status0 = !phone || !st.available || capped ? 'skipped' : 'queued';
  const ins = await db.query(
    `INSERT INTO notify_outbox (tenant_id, channel, to_phone, body, kind, ref, status, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenantId, channel, String(phone || to || '').slice(0, 32), text, kind, ref, status0, !phone ? 'Numéro invalide.' : !st.available ? st.reason : capped ? 'Plafond journalier de messages atteint.' : null]);
  const id = ins.rows[0].id;
  if (status0 === 'skipped') return { status: 'skipped', id, error: !phone ? 'Numéro invalide.' : capped ? 'Plafond journalier de messages atteint.' : st.reason };
  try {
    const sid = await twilioSend(channel, phone, text);
    await db.query(`UPDATE notify_outbox SET status = 'sent', attempts = 1, sent_at = now(), provider_id = $2 WHERE id = $1`, [id, sid]);
    return { status: 'sent', id };
  } catch (e) {
    await db.query(`UPDATE notify_outbox SET status = 'failed', attempts = 1, error = $2 WHERE id = $1`, [id, String(e.message).slice(0, 300)]);
    return { status: 'failed', id, error: e.message };
  }
}

// Responsables à joindre : tous (élèves actifs), ceux d'une classe ou d'un élève. Un responsable n'apparaît qu'une fois.
async function guardians(tenantId, audience) {
  const p = [tenantId]; let where = `s.tenant_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'`;
  if (audience.type === 'class') { p.push(audience.id); where += ` AND s.class_id = $${p.length}`; }
  if (audience.type === 'student') { p.push(audience.id); where += ` AND s.id = $${p.length}`; }
  const r = await db.query(
    `SELECT pr.id, pr.first_name, pr.last_name, pr.email, pr.phone, pr.notify_email, pr.notify_sms, pr.notify_whatsapp,
            array_agg(DISTINCT s.first_name || ' ' || s.last_name) AS children
       FROM students s JOIN student_parents sp ON sp.tenant_id = s.tenant_id AND sp.student_id = s.id
       JOIN parents pr ON pr.tenant_id = sp.tenant_id AND pr.id = sp.parent_id
      WHERE ${where} GROUP BY pr.id ORDER BY pr.last_name, pr.first_name`, p);
  return r.rows;
}

// Un responsable est joignable sur un canal s'il a la coordonnée, n'a pas refusé ce canal, et que le canal est disponible.
function reachable(parent, channel) {
  if (channel === 'email') return !!parent.email && parent.notify_email;
  return !!normalizePhone(parent.phone) && (channel === 'sms' ? parent.notify_sms : parent.notify_whatsapp);
}

const fill = (tpl, parent) => String(tpl).replace(/\{parent\}/g, parent.first_name).replace(/\{enfants\}/g, (parent.children || []).join(', '));

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

// Envoie à un responsable sur les canaux demandés. Retourne { sent, failed, skipped } (une unité par canal tenté).
async function notifyParent({ tenantId, schoolName, parent, channels, subject, body, kind, ref }) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  const text = fill(body, parent);
  for (const ch of channels) {
    if (!reachable(parent, ch)) { out.skipped += 1; continue; }
    const r = ch === 'email'
      ? await deliver({ tenantId, to: parent.email, subject, text: `${text}\n\n— ${schoolName}`, html: htmlLayout({ title: subject, intro: text, footer: `Message de ${schoolName}.` }), kind, ref })
      : await deliverPhone({ tenantId, channel: ch, to: parent.phone, body: `${schoolName} : ${text}`, kind, ref });
    out[r.status === 'sent' ? 'sent' : r.status === 'failed' ? 'failed' : 'skipped'] += 1;
  }
  return out;
}

async function schoolName(tenantId) {
  const r = await db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
  return (r.rows[0] && r.rows[0].name) || 'Établissement';
}

async function broadcast({ tenantId, audience, channels, subject, body, kind = 'broadcast', ref = null }) {
  const list = await guardians(tenantId, audience);
  if (list.length > MAX_RECIPIENTS) { const e = new Error(`Trop de destinataires (${list.length}, maximum ${MAX_RECIPIENTS}) : choisissez une classe.`); e.status = 400; throw e; }
  const name = await schoolName(tenantId);
  const total = { recipients: list.length, sent: 0, failed: 0, skipped: 0 };
  await pool(list, 5, async (parent) => {
    const r = await notifyParent({ tenantId, schoolName: name, parent, channels, subject, body, kind, ref });
    total.sent += r.sent; total.failed += r.failed; total.skipped += r.skipped;
  });
  return total;
}

// Alerte automatique d'absence : une seule fois par élève et par jour (notification_log), sur les canaux choisis par l'établissement.
async function notifyAbsence(tenantId, studentId, date) {
  try {
    const cfg = await db.query('SELECT absence_channels FROM notification_settings WHERE tenant_id = $1', [tenantId]);
    const channels = (cfg.rows[0] && cfg.rows[0].absence_channels) || [];
    if (!channels.length) return null;
    const ref = `${studentId}:${String(date).slice(0, 10)}`;
    const claim = await db.query(`INSERT INTO notification_log (kind, ref, tenant_id) VALUES ('absence', $1, $2) ON CONFLICT DO NOTHING RETURNING ref`, [ref, tenantId]);
    if (!claim.rows.length) return null;
    const list = await guardians(tenantId, { type: 'student', id: studentId });
    const name = await schoolName(tenantId);
    const d = String(date).slice(0, 10).split('-').reverse().join('/');
    const total = { sent: 0, failed: 0, skipped: 0 };
    for (const parent of list) {
      const r = await notifyParent({ tenantId, schoolName: name, parent, channels, subject: `Absence de ${parent.children.join(', ')}`,
        body: `Bonjour {parent}, {enfants} a été noté(e) absent(e) le ${d}. Contactez l’établissement pour toute justification.`, kind: 'absence', ref });
      total.sent += r.sent; total.failed += r.failed; total.skipped += r.skipped;
    }
    return total;
  } catch (e) { return null; } // une alerte ne doit jamais faire échouer la saisie de présence
}


// ---------------------------------------------------------------- Rappels d'impayés
// Impayé = paiement « en_attente ». Rappel automatique : à N jours (réglage de l'établissement) puis 14 et 28 jours plus tard (3 rappels
// au plus par paiement, une seule fois chacun : notification_log). Un responsable reçoit UN message regroupant ses enfants.
const UNPAID_STEP_DAYS = 14;
const money = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))).replace(/[  ]/g, ' ')} F CFA`;

async function unpaidRows(tenantId) {
  const r = await db.query(
    `SELECT pr.id AS parent_id, pr.first_name, pr.last_name, pr.email, pr.phone, pr.notify_email, pr.notify_sms, pr.notify_whatsapp,
            p.id AS payment_id, p.amount::float8 AS amount, p.fee_type, s.first_name || ' ' || s.last_name AS child,
            GREATEST(0, (CURRENT_DATE - p.paid_at::date))::int AS age
       FROM payments p JOIN students s ON s.tenant_id = p.tenant_id AND s.id = p.student_id AND s.deleted_at IS NULL
       JOIN student_parents sp ON sp.tenant_id = s.tenant_id AND sp.student_id = s.id
       JOIN parents pr ON pr.tenant_id = sp.tenant_id AND pr.id = sp.parent_id
      WHERE p.tenant_id = $1 AND p.status = 'en_attente' ORDER BY pr.last_name, pr.first_name, s.last_name, p.paid_at`, [tenantId]);
  return r.rows;
}

function groupByParent(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.parent_id)) map.set(r.parent_id, { id: r.parent_id, first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone, notify_email: r.notify_email, notify_sms: r.notify_sms, notify_whatsapp: r.notify_whatsapp, items: [], children: [] });
    const g = map.get(r.parent_id); g.items.push(r); if (!g.children.includes(r.child)) g.children.push(r.child);
  }
  return [...map.values()];
}

function unpaidBody(g) {
  const lines = g.items.map((i) => `${i.child} : ${money(i.amount)}${i.fee_type ? ` (${i.fee_type})` : ''}`).join(' ; ');
  const total = g.items.reduce((a, i) => a + i.amount, 0);
  return `Bonjour {parent}, un règlement est en attente : ${lines}. Total : ${money(total)}. Merci de passer à l'établissement ou de nous contacter si c'est déjà réglé.`;
}

// Aperçu (tous les impayés, sans condition d'ancienneté).
async function unpaidPreview(tenantId) {
  const groups = groupByParent(await unpaidRows(tenantId));
  return groups.map((g) => ({ parent_id: g.id, parent: `${g.first_name} ${g.last_name}`, children: g.children, amount: g.items.reduce((a, i) => a + i.amount, 0), oldest_days: Math.max(...g.items.map((i) => i.age)),
    sms: reachable(g, 'sms'), whatsapp: reachable(g, 'whatsapp'), email: reachable(g, 'email') }));
}

// Envoi manuel à tous les responsables ayant un impayé.
async function remindUnpaidNow({ tenantId, channels }) {
  const groups = groupByParent(await unpaidRows(tenantId));
  if (groups.length > MAX_RECIPIENTS) { const e = new Error(`Trop de destinataires (${groups.length}, maximum ${MAX_RECIPIENTS}).`); e.status = 400; throw e; }
  const name = await schoolName(tenantId); const total = { recipients: groups.length, sent: 0, failed: 0, skipped: 0 };
  await pool(groups, 5, async (g) => {
    const r = await notifyParent({ tenantId, schoolName: name, parent: g, channels, subject: 'Rappel de paiement', body: unpaidBody(g), kind: 'unpaid', ref: null });
    total.sent += r.sent; total.failed += r.failed; total.skipped += r.skipped;
  });
  return total;
}

// Rappels automatiques (planificateur). Un canal indisponible n'est pas consommé : l'envoi aura lieu dès sa configuration.
async function runUnpaidReminders() {
  const out = { tenants: 0, sent: 0, failed: 0, skipped: 0 };
  const cfgs = await db.query(`SELECT tenant_id, unpaid_channels, unpaid_after_days FROM notification_settings WHERE cardinality(unpaid_channels) > 0`);
  const st = channelStatus();
  for (const c of cfgs.rows) {
    const channels = c.unpaid_channels.filter((ch) => st[ch] && st[ch].available);
    if (!channels.length) continue;
    out.tenants += 1;
    const due = [];
    for (const r of await unpaidRows(c.tenant_id)) {
      if (r.age < c.unpaid_after_days) continue;
      const step = Math.min(2, Math.floor((r.age - c.unpaid_after_days) / UNPAID_STEP_DAYS));
      const ref = `${r.payment_id}:${step}`;
      const logged = await db.query(`SELECT 1 FROM notification_log WHERE kind = 'unpaid' AND ref = $1`, [`${ref}:${r.parent_id}`]);
      if (!logged.rows.length) due.push({ ...r, ref: `${ref}:${r.parent_id}` });
    }
    const name = await schoolName(c.tenant_id);
    for (const g of groupByParent(due)) {
      const r = await notifyParent({ tenantId: c.tenant_id, schoolName: name, parent: g, channels, subject: 'Rappel de paiement', body: unpaidBody(g), kind: 'unpaid', ref: g.items[0].ref });
      out.sent += r.sent; out.failed += r.failed; out.skipped += r.skipped;
      if (r.sent > 0 || (r.failed === 0 && r.skipped === channels.length)) {
        for (const i of g.items) await db.query(`INSERT INTO notification_log (kind, ref, tenant_id) VALUES ('unpaid', $1, $2) ON CONFLICT DO NOTHING`, [i.ref, c.tenant_id]);
      }
    }
  }
  return out;
}

module.exports = { dailyLimit, unpaidPreview, remindUnpaidNow, runUnpaidReminders, UNPAID_STEP_DAYS, CHANNELS, CHANNEL_LABELS, MAX_RECIPIENTS, SMS_MAX, twilioConfig, channelStatus, deliverPhone, guardians, reachable, notifyParent, broadcast, notifyAbsence, schoolName };
