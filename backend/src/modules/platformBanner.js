// Affiche d'accueil d'un établissement : modifiée par le superadmin uniquement (montée sous /api/platform).
//  PUT    /api/platform/tenants/:tenantId/banner/image : envoi brut (image/png|jpeg|webp)
//  PUT    /api/platform/tenants/:tenantId/banner/text  : titre / sous-titre
//  DELETE /api/platform/tenants/:tenantId/banner       : retour à l'affiche par défaut
const express = require('express');
const db = require('../utils/db');
const { validate } = require('../utils/validate');
const { invalid, wrap, HttpError } = require('../utils/http');
const { audit } = require('../utils/audit');
const { BANNER_REQUIREMENTS, checkBanner } = require('../utils/image');
const { targetTenant } = require('./identity');

const rawImage = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: BANNER_REQUIREMENTS.maxBytes + 1024 });
const r = express.Router();

r.get('/', wrap(async (req, res) => {
  const q = await db.query(
    `SELECT (image IS NOT NULL) AS custom, mime, width, height, octet_length(image) AS bytes, title, subtitle, updated_at
       FROM tenant_banners WHERE tenant_id = $1`, [req.targetTenantId]);
  const row = q.rows[0] || { custom: false, mime: null, width: null, height: null, bytes: null, title: null, subtitle: null, updated_at: null };
  res.json({ data: { ...row, custom: !!row.custom, requirements: BANNER_REQUIREMENTS } });
}));

r.get('/image', wrap(async (req, res) => {
  const q = await db.query('SELECT image, mime FROM tenant_banners WHERE tenant_id = $1 AND image IS NOT NULL', [req.targetTenantId]);
  if (!q.rows.length) throw new HttpError(404, 'Aucune affiche personnalisée.');
  res.setHeader('Content-Type', q.rows[0].mime);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(q.rows[0].image);
}));

r.put('/image', rawImage, wrap(async (req, res) => {
  const { info, errors } = checkBanner(req.body);
  if (errors.length) return invalid(res, errors);
  await db.query(
    `INSERT INTO tenant_banners (tenant_id, image, mime, width, height, updated_by, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (tenant_id) DO UPDATE
        SET image = EXCLUDED.image, mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [req.targetTenantId, req.body, info.mime, info.width, info.height, req.user.id]);
  await audit(req, { action: 'platform.banner.update', entity: 'tenant', entityId: req.targetTenantId });
  res.json({ data: { custom: true, mime: info.mime, width: info.width, height: info.height, bytes: info.bytes } });
}));

r.put('/text', wrap(async (req, res) => {
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
    [req.targetTenantId, title, subtitle, req.user.id]);
  await audit(req, { action: 'platform.banner.text', entity: 'tenant', entityId: req.targetTenantId });
  res.json({ data: { title, subtitle } });
}));

r.delete('/', wrap(async (req, res) => {
  await db.query('DELETE FROM tenant_banners WHERE tenant_id = $1', [req.targetTenantId]);
  await audit(req, { action: 'platform.banner.reset', entity: 'tenant', entityId: req.targetTenantId });
  res.json({ data: { custom: false } });
}));

const router = express.Router();
router.use('/tenants/:tenantId/banner', targetTenant, r);
module.exports = router;
