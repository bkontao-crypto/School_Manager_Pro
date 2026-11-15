// Authentification et isolation des établissements.
//
// Règle d'or : l'établissement (tenant) d'une requête vient UNIQUEMENT du jeton signé.
// Le superadmin n'a pas d'établissement : il gère la plateforme (/api/platform) mais n'a AUCUN accès
// aux données privées des établissements (élèves, notes, paiements, RH...). L'en-tête x-tenant-id est ignoré.

const config = require('../config');
const jwt = require('../utils/jwt');
const { accessProblem } = require('../utils/license');
const db = require('../utils/db');

// Lit le jeton "Authorization: Bearer ..." ; renseigne req.user et req.tenantId s'il est valide. Ne bloque jamais.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const payload = jwt.verify(m[1], { secret: config.jwtSecret });
      req.user = {
        id: payload.sub,
        role: payload.role,
        tenantId: payload.tid || null,
        name: payload.name || null
      };
      req.tenantId = req.user.role === 'superadmin' ? null : req.user.tenantId;
    } catch (err) {
      req.authError = err.code === 'expired' ? 'expired' : 'invalid';
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const message = req.authError === 'expired' ? 'Session expirée, reconnectez-vous.' : 'Authentification requise.';
    return res.status(401).json({ error: message, code: req.authError || 'missing' });
  }
  return next();
}

// Vérifie en base, à chaque requête, que le compte existe toujours et est actif, et applique son rôle ACTUEL :
// désactiver un compte ou changer son rôle prend effet immédiatement, sans attendre l'expiration du jeton.
async function requireActiveAccount(req, res, next) {
  try {
    const r = await db.query(
      `SELECT u.role, u.tenant_id, u.is_active, t.status, t.license_end
         FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [req.user.id]);
    const u = r.rows[0];
    if (!u || !u.is_active) return res.status(401).json({ error: 'Compte désactivé ou introuvable.', code: 'invalid' });
    req.user.role = u.role;
    if (u.role === 'superadmin') { req.tenantId = null; req.user.tenantId = null; }
    else {
      // Établissement suspendu ou licence expirée : accès coupé immédiatement, données conservées.
      const problem = accessProblem(u);
      if (problem) return res.status(403).json({ error: problem.message, code: problem.code });
      req.user.tenantId = u.tenant_id; req.tenantId = u.tenant_id;
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Réservé au superadmin.' });
  }
  return next();
}

// Les routes métier exigent un établissement. Le superadmin n'en a pas : accès refusé aux données privées.
function requireTenant(req, res, next) {
  if (req.user && req.user.role === 'superadmin') {
    return res.status(403).json({ error: 'Le super administrateur n’a pas accès aux données des établissements.', code: 'superadmin_no_tenant_data' });
  }
  if (!req.tenantId) return res.status(400).json({ error: 'Établissement introuvable pour ce compte.' });
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Droits insuffisants pour cette action.' });
  };
}

module.exports = { authenticate, requireAuth, requireActiveAccount, requireSuperAdmin, requireTenant, requireRole };
