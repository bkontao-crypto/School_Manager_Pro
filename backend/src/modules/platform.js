// Espace superadmin (plateforme). Monté sous /api/platform, réservé au rôle superadmin (voir index.js).
//
// Le superadmin gère les ÉTABLISSEMENTS (création, coordonnées, pack, licence, quotas, suspension) et
// les mots de passe de leurs administrateurs. Il ne voit JAMAIS les données privées : élèves, notes,
// paiements, RH... Seuls des compteurs d'usage (nombre d'élèves et d'utilisateurs) sont exposés.
// Pas de suppression d'établissement : on suspend (révocation sans perte de données).
// Ses actions sont journalisées avec tenant_id NULL (invisibles dans l'activité des établissements).

const crypto = require('node:crypto');
const express = require('express');
const db = require('../utils/db');
const password = require('../utils/password');
const { validate, isUuid } = require('../utils/validate');
const { HttpError, wrap, invalid, pageParams } = require('../utils/http');
const { audit } = require('../utils/audit');
const { licenseState, today, addDays } = require('../utils/license');
const { csvCell } = require('../utils/csv');
const onlinePayments = require('../utils/onlinePayments');

const router = express.Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENANT_SQL = `
  SELECT t.id, t.code, t.name, t.status, t.created_at, t.plan_id, p.name AS plan_name, t.city,
         t.contact_name, t.contact_email, t.contact_phone, t.contract_ref, t.license_start, t.license_end,
         t.max_students, t.max_users, t.suspended_at, t.suspended_reason, t.notes,
         (SELECT count(*) FROM students s WHERE s.tenant_id = t.id AND s.deleted_at IS NULL) AS students_count,
         (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active) AS users_count
    FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id`;

const withState = (t) => ({ ...t, license_state: licenseState(t) });

// Mot de passe temporaire lisible (sans caractères ambigus), affiché une seule fois au superadmin.
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

const nullable = (spec, except = []) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, except.includes(k) ? v : { ...v, nullable: true }]));

const TENANT_FIELDS = nullable({
  name: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  contact_name: { type: 'string', max: 150 },
  contact_email: { type: 'string', max: 255, pattern: EMAIL, patternMessage: 'Adresse e-mail invalide' },
  contact_phone: { type: 'string', max: 40 },
  contract_ref: { type: 'string', max: 100 },
  plan_id: { type: 'uuid' },
  license_start: { type: 'date' },
  license_end: { type: 'date' },
  max_students: { type: 'int', min: 1, max: 1000000 },
  max_users: { type: 'int', min: 1, max: 100000 },
  notes: { type: 'string', max: 2000 }
}, ['name']);

// ---- Vue d'ensemble ---------------------------------------------------------------------------
router.get('/overview', wrap(async (req, res) => {
  const r = await db.query(`${TENANT_SQL} ORDER BY t.name`);
  const tenants = r.rows.map(withState);
  const by = (s) => tenants.filter((t) => t.license_state === s).length;
  const nearQuota = tenants.filter((t) =>
    (t.max_students && t.students_count >= 0.9 * t.max_students) || (t.max_users && t.users_count >= 0.9 * t.max_users));
  const money = await db.query(
    `SELECT COALESCE(sum(net) FILTER (WHERE status = 'paid' AND date_trunc('month', paid_at) = date_trunc('month', CURRENT_DATE)), 0)::float8 AS paid_month,
            COALESCE(sum(net) FILTER (WHERE status = 'paid' AND date_trunc('year', paid_at) = date_trunc('year', CURRENT_DATE)), 0)::float8 AS paid_year,
            COALESCE(sum(net) FILTER (WHERE status = 'pending'), 0)::float8 AS pending_total,
            count(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE AND net > 0) AS overdue_count,
            COALESCE(sum(net) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE), 0)::float8 AS overdue_total
       FROM (SELECT i.status, i.paid_at, i.due_date, i.amount - COALESCE((SELECT sum(c.amount) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued'), 0) AS net
               FROM subscription_invoices i WHERE i.document_type = 'invoice') x`);
  const recent = await db.query(
    `SELECT a.action, a.created_at, u.full_name AS user_name, a.details
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id IS NULL AND a.action LIKE 'platform.%' ORDER BY a.created_at DESC LIMIT 8`);
  res.json({
    data: {
      tenants: tenants.length,
      active: tenants.filter((t) => t.license_state !== 'suspended' && t.license_state !== 'expired').length,
      suspended: by('suspended'),
      expired: by('expired'),
      expiring: by('expiring'),
      students_total: tenants.reduce((n, t) => n + Number(t.students_count), 0),
      users_total: tenants.reduce((n, t) => n + Number(t.users_count), 0),
      expiring_list: tenants.filter((t) => t.license_state === 'expiring' || t.license_state === 'expired')
        .map((t) => ({ id: t.id, name: t.name, code: t.code, license_end: t.license_end, license_state: t.license_state })),
      near_quota: nearQuota.map((t) => ({ id: t.id, name: t.name, students_count: t.students_count, max_students: t.max_students, users_count: t.users_count, max_users: t.max_users })),
      billing: { ...money.rows[0], overdue_count: Number(money.rows[0].overdue_count) },
      recent: recent.rows
    }
  });
}));

// ---- Établissements -----------------------------------------------------------------------------
router.get('/tenants', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const conds = []; const params = [];
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`); conds.push(`(t.name ILIKE $${params.length} OR t.code ILIKE $${params.length} OR t.city ILIKE $${params.length})`); }
  if (req.query.status === 'suspended' || req.query.status === 'active' || req.query.status === 'preparation') { params.push(req.query.status); conds.push(`t.status = $${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    db.query(`${TENANT_SQL} ${where} ORDER BY t.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    db.query(`SELECT count(*) AS total FROM tenants t ${where}`, params)
  ]);
  res.json({ data: rows.rows.map(withState), meta: { total: Number(count.rows[0].total), limit, offset } });
}));

router.get('/tenants/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  const admins = await db.query(
    `SELECT id, email, full_name, is_active, last_login_at FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY full_name, email`, [req.params.id]);
  res.json({ data: { ...withState(r.rows[0]), admins: admins.rows } });
}));

// Création : établissement + premier administrateur dans une seule transaction.
router.post('/tenants', wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    ...TENANT_FIELDS,
    code: { type: 'string', required: true, min: 2, max: 50, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'Lettres, chiffres, - et _ uniquement' },
    name: { type: 'string', required: true, max: 255 },
    admin_email: { type: 'string', required: true, max: 255, pattern: EMAIL, patternMessage: 'Adresse e-mail invalide' },
    admin_full_name: { type: 'string', required: true, max: 255 },
    admin_password: { type: 'string', max: 200, noTrim: true }
  });
  if (values.admin_password !== undefined && values.admin_password !== '') {
    const weak = password.checkStrength(values.admin_password);
    if (weak) errors.push({ field: 'admin_password', message: weak });
  }
  if (values.license_start && values.license_end && values.license_end < values.license_start) errors.push({ field: 'license_end', message: 'La fin de licence précède son début.' });
  if (errors.length) return invalid(res, errors);

  // Le pack fournit les quotas par défaut ; ils restent modifiables établissement par établissement.
  let maxStudents = values.max_students; let maxUsers = values.max_users;
  if (values.plan_id) {
    const p = await db.query('SELECT max_students, max_users, is_active FROM plans WHERE id = $1', [values.plan_id]);
    if (!p.rows.length || !p.rows[0].is_active) return invalid(res, [{ field: 'plan_id', message: 'Pack inconnu ou désactivé.' }]);
    if (maxStudents == null) maxStudents = p.rows[0].max_students;
    if (maxUsers == null) maxUsers = p.rows[0].max_users;
  }
  const initial = values.admin_password || tempPassword();
  const hash = await password.hash(initial);
  const created = await db.withTransaction(async (client) => {
    const t = await client.query(
      `INSERT INTO tenants (code, name, status, plan_id, city, contact_name, contact_email, contact_phone, contract_ref, license_start, license_end, max_students, max_users, notes)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [values.code.toUpperCase(), values.name, values.plan_id || null, values.city || null, values.contact_name || null, values.contact_email || null,
        values.contact_phone || null, values.contract_ref || null, values.license_start || null, values.license_end || null,
        maxStudents ?? null, maxUsers ?? null, values.notes || null]);
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
      [t.rows[0].id, values.admin_email, hash, values.admin_full_name]);
    return { tenantId: t.rows[0].id, adminId: u.rows[0].id };
  });
  await audit(req, { action: 'platform.tenant_create', entity: 'tenant', entityId: created.tenantId, details: { code: values.code.toUpperCase(), name: values.name } });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [created.tenantId]);
  res.status(201).json({ data: { ...withState(full.rows[0]), admin_id: created.adminId, temporary_password: values.admin_password ? undefined : initial } });
}));

router.put('/tenants/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, TENANT_FIELDS, { partial: true });
  if (errors.length) return invalid(res, errors);
  const cur = await db.query('SELECT license_start, license_end FROM tenants WHERE id = $1', [req.params.id]);
  if (!cur.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  const start = values.license_start !== undefined ? values.license_start : cur.rows[0].license_start;
  const end = values.license_end !== undefined ? values.license_end : cur.rows[0].license_end;
  if (start && end && end < start) return invalid(res, [{ field: 'license_end', message: 'La fin de licence précède son début.' }]);
  if (values.plan_id) {
    const p = await db.query('SELECT is_active FROM plans WHERE id = $1', [values.plan_id]);
    if (!p.rows.length || !p.rows[0].is_active) return invalid(res, [{ field: 'plan_id', message: 'Pack inconnu ou désactivé.' }]);
  }
  // Champs vidés (chaîne vide) -> NULL ; quotas laissés à null = illimité.
  const sets = []; const params = [req.params.id];
  for (const [k, v] of Object.entries(values)) {
    if (k === 'name' && !v) continue;
    params.push(v === '' ? null : v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return invalid(res, [{ field: 'body', message: 'Aucune modification fournie.' }]);
  await db.query(`UPDATE tenants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  await audit(req, { action: 'platform.tenant_update', entity: 'tenant', entityId: req.params.id, details: { fields: Object.keys(values) } });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  res.json({ data: withState(full.rows[0]) });
}));

// Appliquer un pack : copie ses quotas sur l'établissement (modifiables ensuite).
router.post('/tenants/:id/apply-plan', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { plan_id: { type: 'uuid', required: true } });
  if (errors.length) return invalid(res, errors);
  const p = await db.query('SELECT max_students, max_users, is_active FROM plans WHERE id = $1', [values.plan_id]);
  if (!p.rows.length || !p.rows[0].is_active) return invalid(res, [{ field: 'plan_id', message: 'Pack inconnu ou désactivé.' }]);
  const r = await db.query('UPDATE tenants SET plan_id = $2, max_students = $3, max_users = $4, updated_at = now() WHERE id = $1 RETURNING id',
    [req.params.id, values.plan_id, p.rows[0].max_students, p.rows[0].max_users]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  await audit(req, { action: 'platform.plan_apply', entity: 'tenant', entityId: req.params.id, details: { plan_id: values.plan_id } });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  res.json({ data: withState(full.rows[0]) });
}));

// Renouvellement : prolonge la licence d'un nombre de mois à partir de la fin actuelle (ou d'aujourd'hui si expirée).
router.post('/tenants/:id/renew', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { months: { type: 'int', required: true, min: 1, max: 60 } });
  if (errors.length) return invalid(res, errors);
  const r = await db.query(
    `UPDATE tenants SET license_start = COALESCE(license_start, CURRENT_DATE),
            license_end = (GREATEST(COALESCE(license_end, CURRENT_DATE), CURRENT_DATE) + ($2::int * INTERVAL '1 month'))::date,
            updated_at = now() WHERE id = $1 RETURNING id`, [req.params.id, values.months]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  await audit(req, { action: 'platform.license_renew', entity: 'tenant', entityId: req.params.id, details: { months: values.months } });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  res.json({ data: withState(full.rows[0]) });
}));

router.post('/tenants/:id/suspend', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { reason: { type: 'string', max: 300 } });
  if (errors.length) return invalid(res, errors);
  const r = await db.query(`UPDATE tenants SET status = 'suspended', suspended_at = now(), suspended_reason = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [req.params.id, values.reason || null]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  await audit(req, { action: 'platform.tenant_suspend', entity: 'tenant', entityId: req.params.id, details: { reason: values.reason || null } });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  res.json({ data: withState(full.rows[0]) });
}));

router.post('/tenants/:id/reactivate', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(`UPDATE tenants SET status = 'active', suspended_at = NULL, suspended_reason = NULL, updated_at = now() WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  await audit(req, { action: 'platform.tenant_reactivate', entity: 'tenant', entityId: req.params.id });
  const full = await db.query(`${TENANT_SQL} WHERE t.id = $1`, [req.params.id]);
  res.json({ data: withState(full.rows[0]) });
}));

// Réinitialisation du mot de passe d'un administrateur d'établissement (jamais d'un autre rôle).
router.put('/tenants/:id/admins/:userId/password', wrap(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.userId)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body || {}, { password: { type: 'string', max: 200, noTrim: true } });
  if (values.password) { const weak = password.checkStrength(values.password); if (weak) errors.push({ field: 'password', message: weak }); }
  if (errors.length) return invalid(res, errors);
  const next = values.password || tempPassword();
  const hash = await password.hash(next);
  const r = await db.query(`UPDATE users SET password_hash = $3 WHERE id = $2 AND tenant_id = $1 AND role = 'admin' RETURNING id`, [req.params.id, req.params.userId, hash]);
  if (!r.rows.length) throw new HttpError(404, 'Administrateur introuvable dans cet établissement.');
  await audit(req, { action: 'platform.admin_password', entity: 'user', entityId: req.params.userId });
  res.json({ data: { temporary_password: values.password ? undefined : next } });
}));

// Activer / désactiver un administrateur (révocation sans suppression).
router.put('/tenants/:id/admins/:userId/active', wrap(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.userId)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { is_active: { type: 'boolean', required: true } });
  if (errors.length) return invalid(res, errors);
  const r = await db.query(`UPDATE users SET is_active = $3 WHERE id = $2 AND tenant_id = $1 AND role = 'admin' RETURNING id, is_active`, [req.params.id, req.params.userId, values.is_active]);
  if (!r.rows.length) throw new HttpError(404, 'Administrateur introuvable dans cet établissement.');
  await audit(req, { action: values.is_active ? 'platform.admin_enable' : 'platform.admin_disable', entity: 'user', entityId: req.params.userId });
  res.json({ data: r.rows[0] });
}));

// ---- Packs ---------------------------------------------------------------------------------------
const PLAN_FIELDS = nullable({
  code: { type: 'string', required: true, min: 2, max: 30, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'Lettres, chiffres, - et _ uniquement' },
  name: { type: 'string', required: true, max: 100 },
  description: { type: 'string', max: 500 },
  max_students: { type: 'int', min: 1, max: 1000000 },
  max_users: { type: 'int', min: 1, max: 100000 },
  price_monthly: { type: 'number', min: 0, max: 100000000 },
  is_active: { type: 'boolean' }
}, ['code', 'name', 'is_active']);

router.get('/plans', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT p.id, p.code, p.name, p.description, p.max_students, p.max_users, p.price_monthly, p.is_active,
            (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id) AS tenants_count
       FROM plans p ORDER BY p.price_monthly NULLS LAST, p.name`);
  res.json({ data: r.rows });
}));

router.post('/plans', wrap(async (req, res) => {
  const { values, errors } = validate(req.body, PLAN_FIELDS);
  if (errors.length) return invalid(res, errors);
  const r = await db.query(
    `INSERT INTO plans (code, name, description, max_students, max_users, price_monthly, is_active) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE)) RETURNING *`,
    [values.code.toUpperCase(), values.name, values.description || null, values.max_students ?? null, values.max_users ?? null, values.price_monthly ?? null, values.is_active ?? null]);
  await audit(req, { action: 'platform.plan_create', entity: 'plan', entityId: r.rows[0].id });
  res.status(201).json({ data: r.rows[0] });
}));

// Modifier un pack ne change PAS les quotas des établissements déjà abonnés (ils les ont copiés) ; pas de suppression : on désactive.
router.put('/plans/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { ...PLAN_FIELDS, code: { type: 'string', min: 2, max: 30, pattern: /^[A-Za-z0-9_-]+$/ }, name: { type: 'string', max: 100 } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  const sets = []; const params = [req.params.id];
  for (const [k, v] of Object.entries(values)) { params.push(k === 'code' && v ? v.toUpperCase() : (v === '' ? null : v)); sets.push(`${k} = $${params.length}`); }
  if (!sets.length) return invalid(res, [{ field: 'body', message: 'Aucune modification fournie.' }]);
  const r = await db.query(`UPDATE plans SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!r.rows.length) throw new HttpError(404, 'Pack introuvable.');
  await audit(req, { action: 'platform.plan_update', entity: 'plan', entityId: req.params.id });
  res.json({ data: r.rows[0] });
}));


// ---- Facturation des abonnements -----------------------------------------------------------------
// Factures de l'éditeur aux établissements. Numérotation F-AAAA-NNNN (compteur de plateforme, dans la même
// transaction que l'insertion : un échec n'« use » pas de numéro). Une facture payée n'est ni modifiable ni annulable.
const METHODS = ['especes', 'virement', 'orange_money', 'moov_money', 'cheque', 'autre'];
const INVOICE_SQL = `
  SELECT i.id, i.number, i.tenant_id, t.name AS tenant_name, t.code AS tenant_code, i.plan_id, p.name AS plan_name, i.description,
         i.period_start, i.period_end, i.months, i.amount::float8 AS amount, i.status, i.due_date, i.paid_at, i.payment_method,
         i.payment_ref, i.license_extended, i.notes, i.created_at, i.document_type, i.credit_for, cf.number AS credit_for_number,
         COALESCE(i.subtotal, i.amount)::float8 AS subtotal, i.discount_amount::float8 AS discount_amount, i.tax_rate::float8 AS tax_rate,
         i.tax_amount::float8 AS tax_amount, i.last_sent_at,
         (SELECT COALESCE(sum(c.amount), 0) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued')::float8 AS credited,
         (i.status = 'pending' AND i.due_date < CURRENT_DATE) AS overdue
    FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN plans p ON p.id = i.plan_id
    LEFT JOIN subscription_invoices cf ON cf.id = i.credit_for`;

function invoiceFilters(query) {
  const conds = []; const params = [];
  if (isUuid(query.tenant_id)) { params.push(query.tenant_id); conds.push(`i.tenant_id = $${params.length}`); }
  if (query.status === 'overdue') conds.push(`i.status = 'pending' AND i.due_date < CURRENT_DATE`);
  else if (['pending', 'paid', 'cancelled', 'issued'].includes(query.status)) { params.push(query.status); conds.push(`i.status = $${params.length}`); }
  if (query.type === 'invoice' || query.type === 'credit_note') { params.push(query.type); conds.push(`i.document_type = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) { params.push(query.from); conds.push(`i.created_at::date >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) { params.push(query.to); conds.push(`i.created_at::date <= $${params.length}`); }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

router.get('/invoices', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const f = invoiceFilters(req.query);
  const [rows, sums] = await Promise.all([
    db.query(`${INVOICE_SQL} ${f.where} ORDER BY i.created_at DESC, i.number DESC LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`, [...f.params, limit, offset]),
    db.query(
      `SELECT count(*) AS total,
              (COALESCE(sum(i.amount) FILTER (WHERE i.status = 'paid'), 0) - COALESCE(sum(i.amount) FILTER (WHERE i.document_type = 'credit_note' AND cf.status = 'paid'), 0))::float8 AS paid_total,
              COALESCE(sum(i.amount - i.credited) FILTER (WHERE i.status = 'pending'), 0)::float8 AS pending_total,
              COALESCE(sum(i.amount - i.credited) FILTER (WHERE i.status = 'pending' AND i.due_date < CURRENT_DATE), 0)::float8 AS overdue_total
         FROM (SELECT i.*, (SELECT COALESCE(sum(c.amount), 0) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued') AS credited
                 FROM subscription_invoices i ${f.where}) i
         LEFT JOIN subscription_invoices cf ON cf.id = i.credit_for`, f.params)
  ]);
  const s = sums.rows[0];
  res.json({ data: rows.rows, meta: { total: Number(s.total), limit, offset, paid_total: Number(s.paid_total), pending_total: Number(s.pending_total), overdue_total: Number(s.overdue_total) } });
}));

router.get('/invoices.csv', wrap(async (req, res) => {
  const f = invoiceFilters(req.query);
  const r = await db.query(`${INVOICE_SQL} ${f.where} ORDER BY i.created_at DESC, i.number DESC LIMIT 5000`, f.params);
  const head = ['Numéro', 'Type', 'Établissement', 'Code', 'Description', 'Début', 'Fin', 'Mois', 'Montant HT avant remise', 'Remise', 'TVA %', 'TVA', 'Total TTC (F CFA)', 'Statut', 'Échéance', 'Payée le', 'Mode', 'Référence'];
  const label = { pending: 'En attente', paid: 'Payée', cancelled: 'Annulée', issued: 'Émis' };
  const lines = [head.join(';'), ...r.rows.map((x) => [x.number, x.document_type === 'credit_note' ? 'Avoir' : 'Facture', x.tenant_name, x.tenant_code, x.description, x.period_start, x.period_end, x.months, x.subtotal, x.discount_amount, x.tax_rate, x.tax_amount,
    x.document_type === 'credit_note' ? -x.amount : x.amount, x.overdue ? 'En retard' : label[x.status], x.due_date, x.paid_at, x.payment_method, x.payment_ref].map(csvCell).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="factures-abonnements.csv"');
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

router.get('/tenants.csv', wrap(async (req, res) => {
  const r = await db.query(`${TENANT_SQL} ORDER BY t.name`);
  const state = { ok: 'Active', unlimited: 'Illimitée', expiring: 'Expire bientôt', expired: 'Expirée', suspended: 'Suspendu' };
  const head = ['Code', 'Nom', 'Ville', 'Pack', 'Licence', 'Début', 'Fin', 'Élèves', 'Quota élèves', 'Utilisateurs', 'Quota utilisateurs', 'Contact', 'E-mail', 'Téléphone'];
  const lines = [head.join(';'), ...r.rows.map(withState).map((t) => [t.code, t.name, t.city, t.plan_name, state[t.license_state], t.license_start, t.license_end, t.students_count, t.max_students,
    t.users_count, t.max_users, t.contact_name, t.contact_email, t.contact_phone].map(csvCell).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="etablissements.csv"');
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}));

router.get('/invoices/:id/pdf', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const inv = await require('../utils/invoiceData').loadInvoice(req.params.id);
  if (!inv) throw new HttpError(404, 'Facture introuvable.');
  const { renderInvoicePdf, invoiceFilename } = require('../utils/invoiceData');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${invoiceFilename(inv)}"`);
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(renderInvoicePdf(inv));
}));
router.get('/invoices/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(`${INVOICE_SQL} WHERE i.id = $1`, [req.params.id]);
  if (!r.rows.length) throw new HttpError(404, 'Facture introuvable.');
  const t = await db.query('SELECT city, contact_name, contact_email, contact_phone, contract_ref FROM tenants WHERE id = $1', [r.rows[0].tenant_id]);
  const issuer = await db.query('SELECT app_name, slogan, (logo IS NOT NULL) AS has_logo FROM platform_identity');
  const cfg = await billingSettings();
  res.json({ data: { ...r.rows[0], tenant: t.rows[0], issuer: { ...(issuer.rows[0] || { app_name: 'SCHOOL MANAGER PRO', slogan: null, has_logo: false }), legal_details: cfg.legal_details, payment_instructions: cfg.payment_instructions } } });
}));

router.post('/tenants/:id/invoices', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, {
    months: { type: 'int', required: true, min: 1, max: 60 },
    amount: { type: 'number', min: 0, max: 100000000000 },
    discount_percent: { type: 'number', min: 0, max: 100 },
    discount_amount: { type: 'number', min: 0, max: 100000000000 },
    tax_rate: { type: 'number', min: 0, max: 100 },
    description: { type: 'string', max: 300 },
    period_start: { type: 'date' },
    due_date: { type: 'date' },
    notes: { type: 'string', max: 500 }
  });
  if (errors.length) return invalid(res, errors);
  const t = await db.query(`SELECT t.id, t.license_end, p.id AS plan_id, p.name AS plan_name, p.price_monthly FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`, [req.params.id]);
  if (!t.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  const tn = t.rows[0];
  let amount = values.amount;
  if (amount === undefined) {
    if (tn.price_monthly === null || tn.price_monthly === undefined) return invalid(res, [{ field: 'amount', message: 'Montant requis : l’établissement n’a pas de pack avec un prix mensuel.' }]);
    amount = Number(tn.price_monthly) * values.months;
  }
  // Remise puis TVA : total = (montant - remise) + TVA ; arrondis à l'unité (le franc CFA n'a pas de centimes).
  const cfg = await billingSettings();
  const subtotal = amount;
  const discount = values.discount_amount !== undefined ? values.discount_amount : Math.round(subtotal * (values.discount_percent || 0) / 100);
  if (discount > subtotal) return invalid(res, [{ field: 'discount_amount', message: 'La remise dépasse le montant.' }]);
  const taxRate = values.tax_rate !== undefined ? values.tax_rate : cfg.tax_rate;
  const taxable = subtotal - discount;
  const taxAmount = Math.round(taxable * taxRate / 100);
  amount = taxable + taxAmount;
  // Période facturée : à la suite de la licence en cours, sinon à partir d'aujourd'hui.
  const start = values.period_start || (tn.license_end && tn.license_end >= today() ? addDays(tn.license_end, 1) : today());
  const endD = new Date(`${start}T00:00:00Z`); endD.setUTCMonth(endD.getUTCMonth() + values.months); endD.setUTCDate(endD.getUTCDate() - 1);
  const end = endD.toISOString().slice(0, 10);
  const due = values.due_date || addDays(today(), 15);
  const description = values.description || `Abonnement ${tn.plan_name || 'SCHOOL MANAGER PRO'} — ${values.months} mois`;
  const created = await db.withTransaction(async (client) => {
    const c = await client.query(`INSERT INTO platform_counters (name, value) VALUES ('invoice', 1) ON CONFLICT (name) DO UPDATE SET value = platform_counters.value + 1 RETURNING value`);
    const number = `F-${new Date().getFullYear()}-${String(Number(c.rows[0].value)).padStart(4, '0')}`;
    const r = await client.query(
      `INSERT INTO subscription_invoices (tenant_id, number, plan_id, description, period_start, period_end, months, amount, due_date, notes, created_by, subtotal, discount_amount, tax_rate, tax_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [req.params.id, number, tn.plan_id || null, description, start, end, values.months, amount, due, values.notes || null, req.user.id, subtotal, discount, taxRate, taxAmount]);
    return r.rows[0].id;
  });
  await audit(req, { action: 'platform.invoice_create', entity: 'invoice', entityId: created, details: { tenant_id: req.params.id, amount } });
  const full = await db.query(`${INVOICE_SQL} WHERE i.id = $1`, [created]);
  res.status(201).json({ data: full.rows[0] });
}));

// Encaissement : marque la facture payée et, par défaut, prolonge la licence jusqu'à la fin de la période facturée.
router.post('/invoices/:id/pay', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body || {}, {
    paid_at: { type: 'date' }, payment_method: { type: 'enum', values: METHODS, required: true },
    payment_ref: { type: 'string', max: 100 }, extend_license: { type: 'boolean' }
  });
  if (errors.length) return invalid(res, errors);
  const extend = values.extend_license !== false;
  const out = await db.withTransaction(async (client) => {
    const cur = await client.query(`SELECT id, tenant_id, status, period_start, period_end, document_type, amount - COALESCE((SELECT sum(c.amount) FROM subscription_invoices c WHERE c.credit_for = subscription_invoices.id AND c.status = 'issued'), 0) AS payable FROM subscription_invoices WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!cur.rows.length) throw new HttpError(404, 'Facture introuvable.');
    if (cur.rows[0].document_type !== 'invoice') throw new HttpError(409, 'Un avoir ne s’encaisse pas.');
    if (cur.rows[0].status === 'pending' && Number(cur.rows[0].payable) <= 0) throw new HttpError(409, 'Cette facture est entièrement créditée par un avoir.');
    if (cur.rows[0].status !== 'pending') throw new HttpError(409, cur.rows[0].status === 'paid' ? 'Cette facture est déjà payée.' : 'Cette facture est annulée.');
    await client.query(
      `UPDATE subscription_invoices SET status = 'paid', paid_at = $2, payment_method = $3, payment_ref = $4, license_extended = $5 WHERE id = $1`,
      [req.params.id, values.paid_at || today(), values.payment_method, values.payment_ref || null, extend]);
    if (extend) {
      await client.query(
        `UPDATE tenants SET license_start = COALESCE(license_start, $2::date),
                license_end = GREATEST(COALESCE(license_end, $3::date), $3::date), updated_at = now() WHERE id = $1`,
        [cur.rows[0].tenant_id, cur.rows[0].period_start, cur.rows[0].period_end]);
    }
    return cur.rows[0].tenant_id;
  });
  await audit(req, { action: 'platform.invoice_pay', entity: 'invoice', entityId: req.params.id, details: { tenant_id: out, extend } });
  const full = await db.query(`${INVOICE_SQL} WHERE i.id = $1`, [req.params.id]);
  res.json({ data: full.rows[0] });
}));

router.post('/invoices/:id/cancel', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(`UPDATE subscription_invoices SET status = 'cancelled' WHERE id = $1 AND status = 'pending' AND document_type = 'invoice' RETURNING id`, [req.params.id]);
  if (!r.rows.length) {
    const ex = await db.query('SELECT status, document_type FROM subscription_invoices WHERE id = $1', [req.params.id]);
    if (!ex.rows.length) throw new HttpError(404, 'Facture introuvable.');
    if (ex.rows[0].document_type !== 'invoice') throw new HttpError(409, 'Un avoir ne peut pas être annulé.');
    throw new HttpError(409, ex.rows[0].status === 'paid' ? 'Une facture payée ne peut pas être annulée.' : 'Cette facture est déjà annulée.');
  }
  await audit(req, { action: 'platform.invoice_cancel', entity: 'invoice', entityId: req.params.id });
  const full = await db.query(`${INVOICE_SQL} WHERE i.id = $1`, [req.params.id]);
  res.json({ data: full.rows[0] });
}));

// Avoir : document négatif lié à une facture (remboursement ou correction), jusqu'à concurrence du montant restant créditable.
// Numérotation A-AAAA-NNNN. Une facture en attente entièrement créditée est annulée. La licence n'est pas modifiée.
router.post('/invoices/:id/credit-note', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { amount: { type: 'number', required: true, min: 1, max: 100000000000 }, reason: { type: 'string', required: true, max: 300 } });
  if (errors.length) return invalid(res, errors);
  const id = await db.withTransaction(async (client) => {
    const inv = await client.query(
      `SELECT i.*, COALESCE((SELECT sum(c.amount) FROM subscription_invoices c WHERE c.credit_for = i.id AND c.status = 'issued'), 0) AS credited
         FROM subscription_invoices i WHERE i.id = $1 FOR UPDATE`, [req.params.id]);
    if (!inv.rows.length) throw new HttpError(404, 'Facture introuvable.');
    const i = inv.rows[0];
    if (i.document_type !== 'invoice') throw new HttpError(409, 'On ne peut pas créditer un avoir.');
    if (!['pending', 'paid'].includes(i.status)) throw new HttpError(409, 'Seule une facture en attente ou payée peut recevoir un avoir.');
    const room = Number(i.amount) - Number(i.credited);
    if (values.amount > room) throw new HttpError(422, `Montant trop élevé : il reste ${Math.round(room)} F à créditer sur cette facture.`);
    const c = await client.query(`INSERT INTO platform_counters (name, value) VALUES ('credit_note', 1) ON CONFLICT (name) DO UPDATE SET value = platform_counters.value + 1 RETURNING value`);
    const number = `A-${new Date().getFullYear()}-${String(Number(c.rows[0].value)).padStart(4, '0')}`;
    const rate = Number(i.tax_rate);
    const tax = Math.round(values.amount * rate / (100 + rate));
    const ins = await client.query(
      `INSERT INTO subscription_invoices (tenant_id, number, plan_id, description, period_start, period_end, months, amount, status, due_date, notes, created_by,
              document_type, credit_for, subtotal, discount_amount, tax_rate, tax_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'issued', CURRENT_DATE, $9, $10, 'credit_note', $11, $12, 0, $13, $14) RETURNING id`,
      [i.tenant_id, number, i.plan_id, `Avoir sur ${i.number}`, i.period_start, i.period_end, i.months, values.amount, values.reason, req.user.id, i.id, values.amount - tax, rate, tax]);
    if (i.status === 'pending' && values.amount >= room) await client.query(`UPDATE subscription_invoices SET status = 'cancelled' WHERE id = $1`, [i.id]);
    return ins.rows[0].id;
  });
  await audit(req, { action: 'platform.credit_note', entity: 'invoice', entityId: id, details: { credit_for: req.params.id, amount: values.amount } });
  const full = await db.query(`${INVOICE_SQL} WHERE i.id = $1`, [id]);
  res.status(201).json({ data: full.rows[0] });
}));

// Réglages de facturation (TVA par défaut, mentions légales, instructions de paiement).
async function billingSettings() {
  const r = await db.query(`SELECT key, value FROM platform_settings WHERE key IN ('tax_rate', 'legal_details', 'payment_instructions')`);
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return { tax_rate: m.tax_rate === undefined ? 0 : Number(m.tax_rate), legal_details: m.legal_details || '', payment_instructions: m.payment_instructions || '' };
}
router.get('/billing-settings', wrap(async (req, res) => {
  res.json({ data: { ...(await billingSettings()), online_payment: { enabled: false, providers: onlinePayments.PROVIDERS, message: onlinePayments.UNAVAILABLE.message } } });
}));
router.put('/billing-settings', wrap(async (req, res) => {
  const { values, errors } = validate(req.body, { tax_rate: { type: 'number', min: 0, max: 100 }, legal_details: { type: 'string', max: 1000, nullable: true }, payment_instructions: { type: 'string', max: 500, nullable: true } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  for (const [k, v] of Object.entries(values)) {
    await db.query(`INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, v === null ? '' : String(v)]);
  }
  await audit(req, { action: 'platform.billing_settings', entity: 'settings', entityId: null, details: { fields: Object.keys(values) } });
  res.json({ data: { ...(await billingSettings()), online_payment: { enabled: false, providers: onlinePayments.PROVIDERS, message: onlinePayments.UNAVAILABLE.message } } });
}));

// ---- Journal de la plateforme -------------------------------------------------------------------
router.get('/audit', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const [rows, count] = await Promise.all([
    db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, u.full_name AS user_name,
              t.name AS tenant_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN tenants t ON a.entity = 'tenant' AND t.id = a.entity_id
        WHERE a.tenant_id IS NULL ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    db.query('SELECT count(*) AS total FROM audit_logs WHERE tenant_id IS NULL')
  ]);
  res.json({ data: rows.rows, meta: { total: Number(count.rows[0].total), limit, offset } });
}));

module.exports = router;
