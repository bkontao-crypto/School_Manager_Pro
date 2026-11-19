// Paramètres de l'établissement et gestion des comptes utilisateurs (administrateur).
//  GET/PUT /api/settings           : fiche de l'établissement
//  GET/POST /api/users, PUT /:id   : comptes de l'établissement (jamais de superadmin)

const express = require('express');
const { lockQuota } = require('../middleware/quota');
const onlinePayments = require('../utils/onlinePayments');
const permissions = require('../utils/permissions');
const db = require('../utils/db');
const password = require('../utils/password');
const { validate, isUuid } = require('../utils/validate');
const { HttpError, wrap, invalid, pageParams } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { BANNER_REQUIREMENTS, checkBanner } = require('../utils/image');
const { licenseState } = require('../utils/license');

const settings = express.Router();
settings.use('/identity', require('./identity').tenantEdit);
settings.get('/', wrap(async (req, res) => {
  const r = await db.query('SELECT id, code, name, status FROM tenants WHERE id = $1', [req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  res.json({ data: r.rows[0] });
}));
// Barème des notes (§5.1) : lecture pour tous, changement réservé à l'administrateur, refusé si une note dépasse le nouveau barème.
settings.get('/grading', wrap(async (req, res) => {
  const r = await db.query('SELECT grade_scale_max FROM tenants WHERE id = $1', [req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  res.json({ data: { grade_scale_max: Number(r.rows[0].grade_scale_max) } });
}));
settings.put('/grading', requireRole('admin'), wrap(async (req, res) => {
  const raw = req.body && req.body.grade_scale_max;
  const max = typeof raw === 'number' ? raw : NaN;
  if (![10, 20].includes(max)) throw new HttpError(400, 'Barème invalide : 10 ou 20.');
  const over = await db.query('SELECT count(*)::int AS n FROM grades WHERE tenant_id = $1 AND score > $2', [req.tenantId, max]);
  if (over.rows[0].n > 0) throw new HttpError(409, `${over.rows[0].n} note(s) dépassent ce barème : corrigez-les avant de le changer.`);
  await db.query('UPDATE tenants SET grade_scale_max = $2 WHERE id = $1', [req.tenantId, max]);
  await audit(req, { action: 'settings.grading', entity: 'tenant', entityId: req.tenantId, details: { grade_scale_max: max } });
  res.json({ data: { grade_scale_max: max } });
}));
settings.put('/', requireRole('admin'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, { name: { type: 'string', required: true, max: 255 } });
  if (errors.length) return invalid(res, errors);
  const r = await db.query('UPDATE tenants SET name = $2 WHERE id = $1 RETURNING id, code, name, status', [req.tenantId, values.name]);
  await audit(req, { action: 'tenant.update', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: r.rows[0] });
}));

// ---- Affiche d'accueil personnalisable -------------------------------------------------------
// Sans ligne dans tenant_banners, le client affiche l'affiche par défaut livrée avec l'application.
//  GET    /api/settings/banner         : métadonnées + exigences (tous les rôles)
//  GET    /api/settings/banner/image   : image personnalisée (404 si aucune)
//  PUT    /api/settings/banner/image   : envoi brut (Content-Type image/png|jpeg|webp), admin
//  PUT    /api/settings/banner/text    : titre / sous-titre, admin
//  DELETE /api/settings/banner         : retour à l'affiche par défaut, admin
const rawImage = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: BANNER_REQUIREMENTS.maxBytes + 1024 });

settings.get('/banner', wrap(async (req, res) => {
  const r = await db.query(
    `SELECT (image IS NOT NULL) AS custom, mime, width, height, octet_length(image) AS bytes, title, subtitle, updated_at
       FROM tenant_banners WHERE tenant_id = $1`, [req.tenantId]);
  const row = r.rows[0] || { custom: false, mime: null, width: null, height: null, bytes: null, title: null, subtitle: null, updated_at: null };
  res.json({ data: { ...row, custom: !!row.custom, requirements: BANNER_REQUIREMENTS } });
}));

settings.get('/banner/image', wrap(async (req, res) => {
  const r = await db.query('SELECT image, mime, updated_at FROM tenant_banners WHERE tenant_id = $1 AND image IS NOT NULL', [req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Aucune affiche personnalisée.');
  res.setHeader('Content-Type', r.rows[0].mime);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(r.rows[0].image);
}));

settings.put('/banner/image', requireRole('admin'), rawImage, wrap(async (req, res) => {
  const { info, errors } = checkBanner(req.body);
  if (errors.length) return invalid(res, errors);
  await db.query(
    `INSERT INTO tenant_banners (tenant_id, image, mime, width, height, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (tenant_id) DO UPDATE
        SET image = EXCLUDED.image, mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.tenantId, req.body, info.mime, info.width, info.height, req.user.id]);
  await audit(req, { action: 'banner.update', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: { custom: true, mime: info.mime, width: info.width, height: info.height, bytes: info.bytes } });
}));

settings.put('/banner/text', requireRole('admin'), wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    title: { type: 'string', max: 120 },
    subtitle: { type: 'string', max: 240 }
  });
  if (errors.length) return invalid(res, errors);
  const title = values.title || null;
  const subtitle = values.subtitle || null;
  await db.query(
    `INSERT INTO tenant_banners (tenant_id, title, subtitle, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.tenantId, title, subtitle, req.user.id]);
  await audit(req, { action: 'banner.text', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: { title, subtitle } });
}));

settings.delete('/banner', requireRole('admin'), wrap(async (req, res) => {
  await db.query('DELETE FROM tenant_banners WHERE tenant_id = $1', [req.tenantId]);
  await audit(req, { action: 'banner.reset', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: { custom: false } });
}));

// Mon abonnement : pack, licence, quotas et factures de l'établissement (lecture seule, administrateur).
settings.get('/subscription', requireRole('admin'), wrap(async (req, res) => {
  const t = await db.query(
    `SELECT t.name, t.status, t.license_start, t.license_end, t.max_students, t.max_users, p.name AS plan_name,
            (SELECT count(*) FROM students s WHERE s.tenant_id = t.id AND s.deleted_at IS NULL) AS students_count,
            (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active AND u.role <> 'parent') AS users_count
       FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`, [req.tenantId]);
  const inv = await db.query(
    `SELECT id, number, document_type, description, period_start, period_end, amount::float8 AS amount, subtotal::float8 AS subtotal,
            discount_amount::float8 AS discount_amount, tax_rate::float8 AS tax_rate, tax_amount::float8 AS tax_amount, status, due_date, paid_at,
            (status = 'pending' AND due_date < CURRENT_DATE) AS overdue
       FROM subscription_invoices WHERE tenant_id = $1 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 50`, [req.tenantId]);
  const row = t.rows[0];
  res.json({ data: { ...row, students_count: Number(row.students_count), users_count: Number(row.users_count), license_state: licenseState(row), invoices: inv.rows } });
}));

// Permissions par module et par rôle : lecture / modification de la matrice (administrateur uniquement).
settings.get('/permissions', requireRole('admin'), wrap(async (req, res) => {
  const { matrix, overrides } = await permissions.matrix(req.tenantId);
  const defaults = {};
  for (const role of permissions.ROLES) { defaults[role] = {}; for (const m of Object.keys(permissions.MODULES)) defaults[role][m] = permissions.defaultLevel(role, m); }
  res.json({ data: { roles: permissions.ROLES, modules: permissions.MODULES, levels: permissions.LEVELS, matrix, defaults, customized: Object.keys(overrides).filter((r) => Object.keys(overrides[r]).length) } });
}));

settings.put('/permissions', requireRole('admin'), wrap(async (req, res) => {
  const changes = req.body && Array.isArray(req.body.changes) ? req.body.changes : null;
  if (!changes || !changes.length || changes.length > 200) return invalid(res, [{ field: 'changes', message: 'Liste de modifications obligatoire (200 au maximum).' }]);
  const errors = [];
  changes.forEach((c, i) => {
    if (!c || !permissions.ROLES.includes(c.role)) errors.push({ field: `changes[${i}].role`, message: 'Rôle invalide (l’administrateur n’est pas configurable).' });
    if (!c || !Object.prototype.hasOwnProperty.call(permissions.MODULES, c.module)) errors.push({ field: `changes[${i}].module`, message: 'Module inconnu.' });
    if (!c || !permissions.LEVELS.includes(c.level)) errors.push({ field: `changes[${i}].level`, message: 'Niveau invalide (none, read ou write).' });
  });
  if (errors.length) return invalid(res, errors);
  for (const c of changes) {
    if (c.level === permissions.defaultLevel(c.role, c.module)) {
      await db.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role = $2 AND module = $3', [req.tenantId, c.role, c.module]);
    } else {
      await db.query(
        `INSERT INTO role_permissions (tenant_id, role, module, level, updated_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, role, module) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [req.tenantId, c.role, c.module, c.level, req.user.id]);
    }
  }
  await audit(req, { action: 'settings.permissions', entity: 'settings', details: { changes: changes.length } });
  res.json({ data: (await permissions.matrix(req.tenantId)).matrix });
}));

// Retour à la matrice par défaut (tous les rôles, ou un seul avec ?role=).
settings.delete('/permissions', requireRole('admin'), wrap(async (req, res) => {
  const role = req.query.role;
  if (role !== undefined && !permissions.ROLES.includes(role)) return invalid(res, [{ field: 'role', message: 'Rôle invalide.' }]);
  await db.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND ($2::text IS NULL OR role = $2)`, [req.tenantId, role || null]);
  await audit(req, { action: 'settings.permissions_reset', entity: 'settings', details: { role: role || 'all' } });
  res.json({ data: (await permissions.matrix(req.tenantId)).matrix });
}));

// Paiement en ligne (Orange Money / Moov Money) : prévu mais NON disponible. Aucune transaction n'est possible.
settings.get('/payment-providers', requireRole('admin'), wrap(async (req, res) => {
  res.json({ data: { enabled: false, providers: onlinePayments.PROVIDERS, message: onlinePayments.UNAVAILABLE.message } });
}));
settings.post('/subscription/invoices/:id/pay-online', requireRole('admin'), wrap(async (req, res) => {
  res.status(503).json({ error: onlinePayments.UNAVAILABLE.message, code: onlinePayments.UNAVAILABLE.code });
}));

const users = express.Router();
users.use(requireRole('admin'));
const ROLES = ['admin', 'gerant', 'teacher', 'accountant', 'user'];

users.get('/', wrap(async (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const [rows, count] = await Promise.all([
    db.query(`SELECT id, email, full_name, role, is_active, last_login_at, created_at FROM users
               WHERE tenant_id = $1 ORDER BY full_name, email LIMIT $2 OFFSET $3`, [req.tenantId, limit, offset]),
    db.query('SELECT count(*) AS total FROM users WHERE tenant_id = $1', [req.tenantId])
  ]);
  res.json({ data: rows.rows, meta: { total: Number(count.rows[0].total), limit, offset } });
}));

users.post('/', wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    email: { type: 'string', required: true, max: 255, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Adresse e-mail invalide' },
    full_name: { type: 'string', required: true, max: 255 },
    role: { type: 'enum', values: ROLES, required: true },
    password: { type: 'string', required: true, max: 200, noTrim: true }
  });
  const weak = !errors.some((e) => e.field === 'password') && values.password !== undefined && password.checkStrength(values.password);
  if (weak) errors.push({ field: 'password', message: weak });
  if (errors.length) return invalid(res, errors);
  const hash = await password.hash(values.password);
  const r = await db.withTransaction(async (client) => {
    if (values.role !== 'parent') await lockQuota(client, req.tenantId, 'users');
    return client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, role, is_active, created_at`,
      [req.tenantId, values.email, hash, values.full_name, values.role]
    );
  });
  await audit(req, { action: 'user.create', entity: 'user', entityId: r.rows[0].id, details: { role: values.role } });
  res.status(201).json({ data: r.rows[0] });
}));

users.put('/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, {
    full_name: { type: 'string', max: 255 },
    role: { type: 'enum', values: ROLES },
    is_active: { type: 'boolean' }
  }, { partial: true });
  if (errors.length) return invalid(res, errors);
  if (!Object.keys(values).length) throw new HttpError(400, 'Aucune modification fournie.');
  if (req.params.id === req.user.id && (values.role !== undefined || values.is_active === false)) {
    throw new HttpError(400, 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte.');
  }
  if (values.role !== undefined) {
    const cur = await db.query('SELECT role FROM users WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
    if (cur.rows[0] && cur.rows[0].role === 'parent') throw new HttpError(400, 'Le rôle d’un compte parent ne peut pas être modifié.');
  }
  const sets = []; const params = [req.params.id, req.tenantId];
  for (const [k, v] of Object.entries(values)) { params.push(v); sets.push(`${k} = $${params.length}`); }
  const r = await db.withTransaction(async (client) => {
    // Réactivation d'un compte : soumise au quota d'utilisateurs (un compte parent n'y est pas compté).
    if (values.is_active === true) {
      const cur = await client.query('SELECT is_active, role FROM users WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
      if (cur.rows[0] && !cur.rows[0].is_active && cur.rows[0].role !== 'parent') await lockQuota(client, req.tenantId, 'users');
    }
    return client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id, email, full_name, role, is_active`, params);
  });
  if (!r.rows.length) throw new HttpError(404, 'Utilisateur introuvable.');
  await audit(req, { action: 'user.update', entity: 'user', entityId: r.rows[0].id, details: values });
  res.json({ data: r.rows[0] });
}));

// Réinitialisation du mot de passe d'un utilisateur par l'administrateur (mot de passe oublié).
users.put('/:id/password', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body, { new_password: { type: 'string', required: true, max: 200, noTrim: true } });
  const weak = values.new_password !== undefined && password.checkStrength(values.new_password);
  if (weak) errors.push({ field: 'new_password', message: weak });
  if (errors.length) return invalid(res, errors);
  const r = await db.query('UPDATE users SET password_hash = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId, await password.hash(values.new_password)]);
  if (!r.rows.length) throw new HttpError(404, 'Utilisateur introuvable.');
  await audit(req, { action: 'user.password_reset', entity: 'user', entityId: r.rows[0].id });
  res.json({ data: { changed: true } });
}));

module.exports = { settings, users };
