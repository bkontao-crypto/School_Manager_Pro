// Logo utilisé sur les documents PDF : celui de l'établissement, sinon (si demandé) celui de la plateforme.
// Renvoie une image prête pour le moteur PDF, ou null (aucun logo, ou format non pris en charge).

const db = require('./db');
const { detectImage } = require('./imageDecode');

async function loadPlatformLogo() {
  const r = await db.query('SELECT logo FROM platform_identity WHERE singleton = TRUE AND logo IS NOT NULL');
  return r.rows[0] ? detectImage(r.rows[0].logo) : null;
}

async function loadTenantLogo(tenantId, { platformFallback = false } = {}) {
  const r = await db.query('SELECT logo FROM tenant_identity WHERE tenant_id = $1 AND logo IS NOT NULL', [tenantId]);
  if (r.rows[0]) return detectImage(r.rows[0].logo);
  return platformFallback ? loadPlatformLogo() : null;
}

module.exports = { loadTenantLogo, loadPlatformLogo };
