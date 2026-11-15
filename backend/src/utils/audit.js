// Journal d'audit (table audit_logs). Écriture "au mieux" : un échec est journalisé mais ne bloque jamais l'action.

const db = require('./db');

async function audit(req, { action, entity = null, entityId = null, details = null }) {
  try {
    const user = req.user || null;
    await db.query(
      'INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.tenantId || (user && user.tenantId) || null, user ? user.id : null, action, entity, entityId,
        details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('[audit] écriture impossible :', err.message);
  }
}

module.exports = { audit };
