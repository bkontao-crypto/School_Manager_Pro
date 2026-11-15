// Authentification : connexion par e-mail + mot de passe, jeton JWT signé.
// - Un utilisateur d'établissement se connecte avec le code de son établissement (tenant_code).
// - Un superadmin (sans établissement) se connecte sans code.
// Les échecs renvoient toujours le même message, avec un temps de calcul comparable, pour ne pas révéler quels comptes existent.

const express = require('express');
const config = require('../config');
const db = require('../utils/db');
const jwt = require('../utils/jwt');
const password = require('../utils/password');
const { validate } = require('../utils/validate');
const { wrap, invalid } = require('../utils/http');
const { rateLimit } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { accessProblem } = require('../utils/license');
const crypto = require('node:crypto');
const { permissionsFor } = require('../utils/permissions');
const { mailConfig, deliver, htmlLayout } = require('../utils/mailer');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.loginWindowSeconds * 1000,
  max: config.loginMaxAttempts,
  keyFn: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.'
});

const INVALID = { error: 'Identifiants invalides.' };

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    email: { type: 'string', required: true, max: 255 },
    password: { type: 'string', required: true, max: 200, noTrim: true },
    tenant_code: { type: 'string', max: 50 }
  });
  if (errors.length) return invalid(res, errors);

  const result = await db.query(
    `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.full_name, u.role, u.is_active, t.code AS tenant_code, t.name AS tenant_name, t.status AS tenant_status, t.license_end
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = lower($1)
        AND (($2::text IS NULL AND u.tenant_id IS NULL) OR upper(t.code) = upper($2::text))
      LIMIT 1`,
    [values.email, values.tenant_code || null]
  );
  const user = result.rows[0];
  const ok = user ? await password.verify(values.password, user.password_hash) : await password.dummyVerify(values.password);
  if (!user || !ok || !user.is_active) return res.status(401).json(INVALID);

  if (user.tenant_id) {
    const problem = accessProblem({ status: user.tenant_status, license_end: user.license_end });
    if (problem) return res.status(403).json({ error: problem.message, code: problem.code });
  }
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  const token = jwt.sign(
    { sub: user.id, tid: user.tenant_id, role: user.role, name: user.full_name },
    { secret: config.jwtSecret, ttlSeconds: config.jwtTtlSeconds }
  );
  req.user = { id: user.id, tenantId: user.tenant_id };
  req.tenantId = user.tenant_id;
  await audit(req, { action: 'auth.login', entity: 'user', entityId: user.id });

  return res.json({
    data: {
      token,
      expires_in: config.jwtTtlSeconds,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        tenant_id: user.tenant_id,
        tenant_code: user.tenant_code,
        tenant_name: user.tenant_name
      }
    }
  });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  const result = await db.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.tenant_id, t.code AS tenant_code, t.name AS tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.is_active = TRUE`,
    [req.user.id]
  );
  if (!result.rows.length) return res.status(401).json({ error: 'Compte introuvable ou désactivé.', code: 'invalid' });
  const me = result.rows[0];
  if (me.tenant_id && me.role !== 'superadmin') me.permissions = await permissionsFor(me.tenant_id, me.role);
  return res.json({ data: me });
}));

const passwordLimiter = rateLimit({
  windowMs: config.loginWindowSeconds * 1000,
  max: config.loginMaxAttempts,
  keyFn: (req) => `pwd|${req.user && req.user.id}`,
  message: 'Trop de tentatives. Réessayez dans quelques minutes.'
});

// Changement de son propre mot de passe (l'ancien est exigé).
router.post('/password', requireAuth, passwordLimiter, wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    current_password: { type: 'string', required: true, max: 200, noTrim: true },
    new_password: { type: 'string', required: true, max: 200, noTrim: true }
  });
  const weak = values.new_password !== undefined && password.checkStrength(values.new_password);
  if (weak) errors.push({ field: 'new_password', message: weak });
  if (errors.length) return invalid(res, errors);
  const r = await db.query('SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE', [req.user.id]);
  const ok = r.rows.length ? await password.verify(values.current_password, r.rows[0].password_hash) : await password.dummyVerify(values.current_password);
  if (!ok) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await password.hash(values.new_password)]);
  await audit(req, { action: 'auth.password_change', entity: 'user', entityId: req.user.id });
  return res.json({ data: { changed: true } });
}));

// Mot de passe oublié : lien à usage unique (1 h) envoyé par e-mail. La réponse est identique que le compte existe ou non.
// Le jeton n'est stocké que sous forme d'empreinte SHA-256. Sans e-mail configuré, on l'indique (503) au lieu de faire semblant.
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const forgotLimiter = rateLimit({
  windowMs: config.loginWindowSeconds * 1000,
  max: 5,
  keyFn: (req) => `forgot|${req.ip}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  message: 'Trop de demandes. Réessayez dans quelques minutes.'
});

router.post('/forgot', forgotLimiter, wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    email: { type: 'string', required: true, max: 255 },
    tenant_code: { type: 'string', max: 50 }
  });
  if (errors.length) return invalid(res, errors);
  const cfg = mailConfig();
  if (!cfg.configured || !cfg.appUrl) {
    return res.status(503).json({ error: 'L’envoi d’e-mails n’est pas configuré sur ce serveur. Contactez votre administrateur pour réinitialiser votre mot de passe.', code: 'mail_unavailable' });
  }
  const r = await db.query(
    `SELECT u.id, u.tenant_id, u.email, u.full_name, t.name AS tenant_name, t.status AS tenant_status, t.license_end
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = lower($1) AND u.is_active = TRUE
        AND (($2::text IS NULL AND u.tenant_id IS NULL) OR upper(t.code) = upper($2::text)) LIMIT 1`,
    [values.email, values.tenant_code || null]);
  const u = r.rows[0];
  if (u && !(u.tenant_id && accessProblem({ status: u.tenant_status, license_end: u.license_end }))) {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [u.id]);
    await db.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [u.id, sha256(token)]);
    const link = `${cfg.appUrl}/#reset=${token}`;
    const intro = `Une réinitialisation du mot de passe a été demandée pour votre compte${u.tenant_name ? ` (${u.tenant_name})` : ''}.\nCe lien est valable 1 heure et ne peut servir qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.`;
    await deliver({ tenantId: u.tenant_id, to: u.email, subject: 'Réinitialisation de votre mot de passe',
      text: `${intro}\n\n${link}\n`, html: htmlLayout({ title: 'Réinitialisation du mot de passe', intro, button: { url: link, label: 'Choisir un nouveau mot de passe' }, footer: 'Message automatique.' }), kind: 'password_reset' });
  }
  return res.json({ data: { requested: true }, message: 'Si un compte correspond, un e-mail avec un lien de réinitialisation vient d’être envoyé.' });
}));

router.post('/reset', forgotLimiter, wrap(async (req, res) => {
  const { values, errors } = validate(req.body, {
    token: { type: 'string', required: true, max: 200 },
    new_password: { type: 'string', required: true, max: 200, noTrim: true }
  });
  const weak = values.new_password !== undefined && password.checkStrength(values.new_password);
  if (weak) errors.push({ field: 'new_password', message: weak });
  if (errors.length) return invalid(res, errors);
  const upd = await db.query(
    `UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha256(values.token)]);
  if (!upd.rows.length) return res.status(400).json({ error: 'Lien invalide ou expiré. Refaites une demande.', code: 'invalid_token' });
  const uid = upd.rows[0].user_id;
  const du = await db.query('UPDATE users SET password_hash = $2 WHERE id = $1 AND is_active = TRUE RETURNING tenant_id', [uid, await password.hash(values.new_password)]);
  await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [uid]);
  req.user = { id: uid, tenantId: du.rows[0] ? du.rows[0].tenant_id : null };
  await audit(req, { action: 'auth.password_reset', entity: 'user', entityId: uid });
  return res.json({ data: { changed: true } });
}));

module.exports = router;
