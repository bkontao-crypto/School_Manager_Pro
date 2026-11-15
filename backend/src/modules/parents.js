// Création des accès du portail parent (administrateur). Un responsable a au plus un compte, rôle « parent ».
// POST /api/parents/:id/account {email?, password?} : mot de passe provisoire généré s'il est omis, affiché une seule fois.
// DELETE /api/parents/:id/account : supprime l'accès (la fiche responsable est conservée).

const crypto = require('crypto');
const express = require('express');
const db = require('../utils/db');
const password = require('../utils/password');
const { validate, isUuid } = require('../utils/validate');
const { wrap, invalid, HttpError } = require('../utils/http');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(requireRole('admin'));

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

router.post('/:id/account', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body || {}, {
    email: { type: 'string', max: 255, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Adresse e-mail invalide' },
    password: { type: 'string', max: 200, noTrim: true }
  }, { partial: true });
  if (values.password) { const weak = password.checkStrength(values.password); if (weak) errors.push({ field: 'password', message: weak }); }
  if (errors.length) return invalid(res, errors);
  const p = await db.query('SELECT id, first_name, last_name, email FROM parents WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!p.rows.length) throw new HttpError(404, 'Responsable introuvable.');
  const parent = p.rows[0];
  const email = values.email || parent.email;
  if (!email) throw new HttpError(400, 'Une adresse e-mail est nécessaire pour créer l’accès.', { errors: [{ field: 'email', message: 'Adresse e-mail requise' }] });
  const linked = await db.query('SELECT 1 FROM student_parents WHERE parent_id = $1 AND tenant_id = $2 LIMIT 1', [parent.id, req.tenantId]);
  if (!linked.rows.length) throw new HttpError(409, 'Ce responsable n’est rattaché à aucun élève.');
  if ((await db.query('SELECT 1 FROM parent_accounts WHERE tenant_id = $1 AND parent_id = $2', [req.tenantId, parent.id])).rows.length) throw new HttpError(409, 'Ce responsable a déjà un accès.');
  const initial = values.password || tempPassword();
  const hash = await password.hash(initial);
  const user = await db.withTransaction(async (client) => {
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'parent') RETURNING id, email`,
      [req.tenantId, email, hash, `${parent.first_name} ${parent.last_name}`]);
    await client.query('INSERT INTO parent_accounts (tenant_id, parent_id, user_id, created_by) VALUES ($1, $2, $3, $4)', [req.tenantId, parent.id, u.rows[0].id, req.user.id]);
    if (!parent.email) await client.query('UPDATE parents SET email = $3 WHERE id = $1 AND tenant_id = $2', [parent.id, req.tenantId, email]);
    return u.rows[0];
  });
  await audit(req, { action: 'parent.account_create', entity: 'parent', entityId: parent.id, details: { user_id: user.id } });
  res.status(201).json({ data: { user_id: user.id, email: user.email, temp_password: values.password ? null : initial } });
}));

router.put('/:id/preferences', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const { values, errors } = validate(req.body || {}, { notify_email: { type: 'boolean' }, notify_sms: { type: 'boolean' }, notify_whatsapp: { type: 'boolean' } }, { partial: true });
  if (errors.length) return invalid(res, errors);
  if (!Object.keys(values).length) throw new HttpError(400, 'Aucune modification fournie.');
  const sets = []; const params = [req.params.id, req.tenantId];
  for (const [k, v] of Object.entries(values)) { params.push(v); sets.push(`${k} = $${params.length}`); }
  const r = await db.query(`UPDATE parents SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id, notify_email, notify_sms, notify_whatsapp`, params);
  if (!r.rows.length) throw new HttpError(404, 'Responsable introuvable.');
  await audit(req, { action: 'parent.preferences', entity: 'parent', entityId: req.params.id, details: values });
  res.json({ data: r.rows[0] });
}));

router.delete('/:id/account', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query('DELETE FROM users WHERE id = (SELECT user_id FROM parent_accounts WHERE tenant_id = $1 AND parent_id = $2) AND tenant_id = $1 RETURNING id', [req.tenantId, req.params.id]);
  if (!r.rows.length) throw new HttpError(404, 'Aucun accès pour ce responsable.');
  await audit(req, { action: 'parent.account_delete', entity: 'parent', entityId: req.params.id });
  res.json({ data: { removed: true } });
}));

module.exports = router;
