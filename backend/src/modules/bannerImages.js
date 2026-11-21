// Bannière multi-images de l'établissement (montée sous /api/settings/banner/images).
//  GET    /                 : liste (sans octets), ouverte à tous les utilisateurs de l'établissement
//  GET    /:id/file         : image, authentifiée et limitée au tenant
//  POST   /                 : ajout (administrateur), 6 images maximum
//  PUT    /order            : ordre d'affichage (administrateur) — { ids: [...] } couvrant toutes les images
//  PUT    /:id              : cadrage { focal_x, focal_y } et / ou { is_primary: true } (administrateur)
//  DELETE /:id              : suppression (administrateur) ; si l'image principale disparaît, la première devient principale

const express = require('express');
const db = require('../utils/db');
const { HttpError, wrap, invalid } = require('../utils/http');
const { isUuid } = require('../utils/validate');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { BANNER_REQUIREMENTS, checkBanner } = require('../utils/image');

const MAX_IMAGES = 6;
const rawImage = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: BANNER_REQUIREMENTS.maxBytes + 1024 });
const admin = requireRole('admin');
const router = express.Router();

const LIST_COLS = 'id, position, is_primary, focal_x, focal_y, width, height, mime';
const shape = (r) => ({
  id: r.id, position: r.position, is_primary: r.is_primary, width: r.width, height: r.height, mime: r.mime,
  focal_x: Number(r.focal_x), focal_y: Number(r.focal_y), url: `/api/settings/banner/images/${r.id}/file`
});
const checkId = (req, res, next) => (isUuid(req.params.id) ? next() : invalid(res, ['Identifiant d’image invalide.']));
const cutFocal = (v) => { const n = typeof v === 'number' ? v : NaN; return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null; };

router.get('/', wrap(async (req, res) => {
  const q = await db.query(`SELECT ${LIST_COLS} FROM tenant_banner_images WHERE tenant_id = $1 ORDER BY position, created_at`, [req.tenantId]);
  res.json({ data: { items: q.rows.map(shape), max: MAX_IMAGES, requirements: BANNER_REQUIREMENTS } });
}));

router.get('/:id/file', checkId, wrap(async (req, res) => {
  const q = await db.query('SELECT image, mime FROM tenant_banner_images WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  if (!q.rows.length) throw new HttpError(404, 'Image introuvable.');
  res.setHeader('Content-Type', q.rows[0].mime);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(q.rows[0].image);
}));

router.post('/', admin, rawImage, wrap(async (req, res) => {
  const { info, errors } = checkBanner(req.body);
  if (errors.length) return invalid(res, errors);
  const row = await db.withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`banner-images:${req.tenantId}`]);
    const c = await client.query('SELECT count(*)::int AS n, COALESCE(MAX(position), -1) + 1 AS next FROM tenant_banner_images WHERE tenant_id = $1', [req.tenantId]);
    if (c.rows[0].n >= MAX_IMAGES) throw new HttpError(400, `Limite atteinte : ${MAX_IMAGES} images maximum par établissement.`);
    const ins = await client.query(
      `INSERT INTO tenant_banner_images (tenant_id, image, mime, width, height, position, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${LIST_COLS}`,
      [req.tenantId, req.body, info.mime, info.width, info.height, c.rows[0].next, c.rows[0].n === 0]);
    return ins.rows[0];
  });
  await audit(req, { action: 'banner.image.add', entity: 'tenant', entityId: req.tenantId });
  res.status(201).json({ data: shape(row) });
}));

router.put('/order', admin, wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
  if (!ids || !ids.every(isUuid)) return invalid(res, ['Liste d’images invalide.']);
  const current = (await db.query('SELECT id FROM tenant_banner_images WHERE tenant_id = $1', [req.tenantId])).rows.map((r) => r.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
    return invalid(res, ['La liste doit contenir chaque image de l’établissement, une seule fois.']);
  }
  await db.withTransaction(async (client) => {
    for (const [i, id] of ids.entries()) await client.query('UPDATE tenant_banner_images SET position = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [i, id, req.tenantId]);
  });
  await audit(req, { action: 'banner.image.order', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: { ids } });
}));

router.put('/:id', admin, checkId, wrap(async (req, res) => {
  const body = req.body || {};
  const fx = body.focal_x === undefined ? undefined : cutFocal(body.focal_x);
  const fy = body.focal_y === undefined ? undefined : cutFocal(body.focal_y);
  if (fx === null || fy === null) return invalid(res, ['Le cadrage doit être compris entre 0 et 100 %.']);
  if (body.is_primary !== undefined && body.is_primary !== true) return invalid(res, ['Seule la définition de l’image principale est possible.']);
  const row = await db.withTransaction(async (client) => {
    const cur = await client.query('SELECT id FROM tenant_banner_images WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!cur.rows.length) throw new HttpError(404, 'Image introuvable.');
    if (body.is_primary === true) {
      await client.query('UPDATE tenant_banner_images SET is_primary = false WHERE tenant_id = $1 AND is_primary', [req.tenantId]);
      await client.query('UPDATE tenant_banner_images SET is_primary = true WHERE id = $1', [req.params.id]);
    }
    const sets = ['updated_at = now()']; const params = [req.params.id, req.tenantId];
    if (fx !== undefined) { params.push(fx); sets.push(`focal_x = $${params.length}`); }
    if (fy !== undefined) { params.push(fy); sets.push(`focal_y = $${params.length}`); }
    const u = await client.query(`UPDATE tenant_banner_images SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING ${LIST_COLS}`, params);
    return u.rows[0];
  });
  await audit(req, { action: 'banner.image.update', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: shape(row) });
}));

router.delete('/:id', admin, checkId, wrap(async (req, res) => {
  await db.withTransaction(async (client) => {
    const del = await client.query('DELETE FROM tenant_banner_images WHERE id = $1 AND tenant_id = $2 RETURNING is_primary', [req.params.id, req.tenantId]);
    if (!del.rows.length) throw new HttpError(404, 'Image introuvable.');
    if (del.rows[0].is_primary) {
      await client.query(`UPDATE tenant_banner_images SET is_primary = true WHERE id = (
        SELECT id FROM tenant_banner_images WHERE tenant_id = $1 ORDER BY position, created_at LIMIT 1)`, [req.tenantId]);
    }
  });
  await audit(req, { action: 'banner.image.delete', entity: 'tenant', entityId: req.tenantId });
  res.json({ data: { deleted: req.params.id } });
}));

module.exports = router;
