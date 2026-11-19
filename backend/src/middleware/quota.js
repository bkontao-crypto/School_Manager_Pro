// Quotas du pack (élèves, utilisateurs) : refus à la création quand la limite de l'établissement est atteinte.
const db = require('../utils/db');
const { HttpError } = require('../utils/http');

const QUERIES = {
  students: {
    label: 'élèves',
    sql: `SELECT t.max_students AS max, (SELECT count(*) FROM students s WHERE s.tenant_id = t.id AND s.deleted_at IS NULL) AS used FROM tenants t WHERE t.id = $1`
  },
  users: {
    label: 'utilisateurs',
    sql: `SELECT t.max_users AS max, (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active AND u.role <> 'parent') AS used FROM tenants t WHERE t.id = $1`
  }
};

function enforceQuota(kind) {
  const q = QUERIES[kind];
  return async (req, res, next) => {
    try {
      const r = await db.query(q.sql, [req.tenantId]);
      const row = r.rows[0];
      if (row && row.max !== null && row.max !== undefined && Number(row.used) >= Number(row.max)) {
        return res.status(403).json({ error: `Quota atteint : votre pack autorise ${row.max} ${q.label}. Contactez l’éditeur pour passer à un pack supérieur.`, code: 'quota_exceeded' });
      }
      return next();
    } catch (err) { return next(err); }
  };
}

// Contrôle faisant autorité, exécuté DANS la transaction qui crée ou réactive le compte.
// Verrou transactionnel par établissement et par type de quota : deux créations simultanées ne peuvent pas dépasser la limite.
async function lockQuota(client, tenantId, kind) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`quota:${kind}:${tenantId}`]);
  const r = await client.query(QUERIES[kind].sql, [tenantId]);
  const row = r.rows[0];
  if (row && row.max !== null && row.max !== undefined && Number(row.used) >= Number(row.max)) {
    throw new HttpError(403, `Quota atteint : votre pack autorise ${row.max} ${QUERIES[kind].label}. Contactez l’éditeur pour passer à un pack supérieur.`, { code: 'quota_exceeded' });
  }
}

module.exports = { enforceQuota, lockQuota };
