// Identité de l'application : nom, slogan et logo.
//  - plateforme (superadmin)  : valeurs par défaut pour tous les établissements, visibles aussi sur la page de connexion ;
//  - établissement (admin)    : surcharge pour son école. Priorité : établissement > plateforme > valeurs intégrées.
// Le logo est une image carrée (PNG/JPEG/WebP) contrôlée sur sa signature binaire, jamais sur son extension.
const express = require('express');
const db = require('../utils/db');
const { validate, isUuid } = require('../utils/validate');
const { HttpError, wrap, invalid } = require('../utils/http');
const { audit } = require('../utils/audit');
const { requireRole } = require('../middleware/auth');
const { LOGO_REQUIREMENTS, checkLogo } = require('../utils/image');

const DEFAULTS = Object.freeze({ app_name: 'SCHOOL MANAGER PRO', slogan: null });
const rawLogo = () => express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: LOGO_REQUIREMENTS.maxBytes + 1024 });
const META = 'app_name, slogan, (logo IS NOT NULL) AS has_logo, logo_mime, logo_width, logo_height, octet_length(logo) AS logo_bytes, updated_at';

const readOwn = async (table, keyCol, key) => (await db.query(`SELECT ${META} FROM ${table} WHERE ${keyCol} = $1`, [key])).rows[0] || null;
const readLogo = async (table, keyCol, key) => (await db.query(`SELECT logo, logo_mime FROM ${table} WHERE ${keyCol} = $1 AND logo IS NOT NULL`, [key])).rows[0] || null;

function sendLogo(res, row) {
  res.setHeader('Content-Type', row.logo_mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(row.logo);
}

// Routeur d'édition, identique pour la plateforme et pour un établissement.
//   cfg = { table, keyCol, key(req), prefix, roles, effective(req) -> objet fusionné ou null }
function editRouter(cfg) {
  const r = express.Router();
  const own = (req) => readOwn(cfg.table, cfg.keyCol, cfg.key(req));

  r.get('/', wrap(async (req, res) => {
    const mine = await own(req);
    const eff = cfg.effective ? await cfg.effective(req, mine) : { app_name: (mine && mine.app_name) || DEFAULTS.app_name, slogan: mine ? mine.slogan : null, has_logo: !!(mine && mine.has_logo), source: mine ? 'custom' : 'default' };
    res.json({ data: { effective: eff, custom: mine || { app_name: null, slogan: null, has_logo: false }, requirements: LOGO_REQUIREMENTS } });
  }));

  r.get('/logo', wrap(async (req, res) => {
    let row = await readLogo(cfg.table, cfg.keyCol, cfg.key(req));
    if (!row && cfg.fallbackLogo) row = await cfg.fallbackLogo(req);
    if (!row) throw new HttpError(404, 'Aucun logo personnalisé.');
    sendLogo(res, row);
  }));

  r.put('/logo', cfg.guard, rawLogo(), wrap(async (req, res) => {
    const { info, errors } = checkLogo(req.body);
    if (errors.length) return invalid(res, errors);
    await db.query(
      `INSERT INTO ${cfg.table} (${cfg.keyCol}, logo, logo_mime, logo_width, logo_height, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (${cfg.keyCol}) DO UPDATE SET logo = EXCLUDED.logo, logo_mime = EXCLUDED.logo_mime, logo_width = EXCLUDED.logo_width,
              logo_height = EXCLUDED.logo_height, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [cfg.key(req), req.body, info.mime, info.width, info.height, req.user.id]);
    await audit(req, { action: `${cfg.prefix}.logo`, entity: 'identity', entityId: cfg.entityId ? cfg.entityId(req) : null });
    res.json({ data: { has_logo: true, width: info.width, height: info.height, bytes: info.bytes } });
  }));

  r.delete('/logo', cfg.guard, wrap(async (req, res) => {
    await db.query(`UPDATE ${cfg.table} SET logo = NULL, logo_mime = NULL, logo_width = NULL, logo_height = NULL, updated_at = now() WHERE ${cfg.keyCol} = $1`, [cfg.key(req)]);
    await audit(req, { action: `${cfg.prefix}.logo_remove`, entity: 'identity', entityId: cfg.entityId ? cfg.entityId(req) : null });
    res.json({ data: { has_logo: false } });
  }));

  r.put('/text', cfg.guard, wrap(async (req, res) => {
    const { values, errors } = validate(req.body, { app_name: { type: 'string', max: 60, nullable: true }, slogan: { type: 'string', max: 120, nullable: true } });
    if (errors.length) return invalid(res, errors);
    const appName = values.app_name || null; const slogan = values.slogan || null;
    await db.query(
      `INSERT INTO ${cfg.table} (${cfg.keyCol}, app_name, slogan, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (${cfg.keyCol}) DO UPDATE SET app_name = EXCLUDED.app_name, slogan = EXCLUDED.slogan, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [cfg.key(req), appName, slogan, req.user.id]);
    await audit(req, { action: `${cfg.prefix}.text`, entity: 'identity', entityId: cfg.entityId ? cfg.entityId(req) : null });
    res.json({ data: { app_name: appName, slogan } });
  }));

  // Retour aux valeurs par défaut (texte et logo).
  r.delete('/', cfg.guard, wrap(async (req, res) => {
    await db.query(`DELETE FROM ${cfg.table} WHERE ${cfg.keyCol} = $1`, [cfg.key(req)]);
    await audit(req, { action: `${cfg.prefix}.reset`, entity: 'identity', entityId: cfg.entityId ? cfg.entityId(req) : null });
    res.json({ data: { custom: false } });
  }));
  return r;
}

// Identité de la plateforme : édition réservée au superadmin (garde posée à l'montage dans index.js).
const platformEdit = editRouter({
  table: 'platform_identity', keyCol: 'singleton', key: () => true, prefix: 'platform.identity', guard: (req, res, next) => next()
});

// Identité d'un établissement : lecture pour tous ses utilisateurs, écriture pour l'administrateur.
const tenantCfgBase = {
  table: 'tenant_identity', keyCol: 'tenant_id', prefix: 'identity',
  async effective(req, mine) {
    const plat = await readOwn('platform_identity', 'singleton', true);
    const name = (mine && mine.app_name) || (plat && plat.app_name) || DEFAULTS.app_name;
    const slogan = mine && mine.slogan ? mine.slogan : (plat ? plat.slogan : null);
    const own = !!(mine && mine.has_logo);
    const inherited = !own && !!(plat && plat.has_logo);
    return { app_name: name, slogan, has_logo: own || inherited, logo_source: own ? 'tenant' : (inherited ? 'platform' : null),
      source: mine && (mine.app_name || mine.slogan || mine.has_logo) ? 'tenant' : (plat && (plat.app_name || plat.slogan || plat.has_logo) ? 'platform' : 'default') };
  },
  fallbackLogo: () => readLogo('platform_identity', 'singleton', true)
};

// Identité propre à l'établissement : lecture pour tous ses utilisateurs, écriture pour son administrateur.
// Le logo et le nom du site (plateforme) restent gérés par le superadmin (platformEdit).
const tenantEdit = editRouter({ ...tenantCfgBase, key: (req) => req.tenantId, entityId: (req) => req.tenantId, guard: requireRole('admin') });

// Public (page de connexion) : identité de la plateforme uniquement, aucune donnée d'établissement.
const publicRouter = express.Router();
publicRouter.get('/', wrap(async (req, res) => {
  const p = await readOwn('platform_identity', 'singleton', true);
  res.json({ data: { app_name: (p && p.app_name) || DEFAULTS.app_name, slogan: p ? p.slogan : null, has_logo: !!(p && p.has_logo), updated_at: p ? p.updated_at : null } });
}));
publicRouter.get('/logo', wrap(async (req, res) => {
  const row = await readLogo('platform_identity', 'singleton', true);
  if (!row) throw new HttpError(404, 'Aucun logo.');
  sendLogo(res, row);
}));

// Établissement ciblé par le superadmin (/api/platform/tenants/:tenantId/…) : existence vérifiée avant toute écriture.
const targetTenant = wrap(async (req, res, next) => {
  if (!isUuid(req.params.tenantId)) throw new HttpError(400, 'Identifiant d’établissement invalide.');
  const t = await db.query('SELECT 1 FROM tenants WHERE id = $1', [req.params.tenantId]);
  if (!t.rows.length) throw new HttpError(404, 'Établissement introuvable.');
  req.targetTenantId = req.params.tenantId;
  next();
});

// Identité d'un établissement, éditée par le superadmin (/api/platform/tenants/:tenantId/identity).
const platformTenantIdentity = express.Router();
platformTenantIdentity.use('/tenants/:tenantId/identity', targetTenant, editRouter({
  ...tenantCfgBase, key: (req) => req.targetTenantId, entityId: (req) => req.targetTenantId,
  prefix: 'platform.tenant_identity', guard: (req, res, next) => next()
}));

module.exports = { platformEdit, tenantEdit, publicRouter, DEFAULTS, platformTenantIdentity, targetTenant };
