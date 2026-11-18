// Périodes scolaires nommées (trimestres, semestres). Lecture : tous ; création, suppression et clôture : administrateur.
// Une période clôturée n'est plus supprimable et verrouille les notes dont la date tombe dans sa plage (grades.js).

const db = require('../utils/db');
const { makeResource } = require('../utils/resource');
const { HttpError, wrap } = require('../utils/http');
const { isUuid } = require('../utils/validate');
const { requireWrite } = require('../utils/permissions');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../utils/audit');

const router = makeResource({
  entity: 'academic_period',
  table: 'academic_periods',
  select: "id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, closed_at",
  orderBy: 'start_date',
  fields: {
    name: { type: 'string', required: true, max: 100 },
    start_date: { type: 'date', required: true },
    end_date: { type: 'date', required: true }
  },
  module: 'periods',
  create: async (req, v) => {
    if (v.end_date < v.start_date) throw new HttpError(400, 'Données invalides', { errors: [{ field: 'end_date', message: 'La date de fin doit suivre la date de début' }] });
    const r = await db.query('INSERT INTO academic_periods (tenant_id, name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.tenantId, v.name, v.start_date, v.end_date]);
    return r.rows[0];
  }
});

// Retourne 404 si la période n'existe pas dans l'établissement, sinon 409 avec le motif (ex. déjà clôturée).
async function missingOrConflict(req, id, reason) {
  const p = await db.query('SELECT closed_at FROM academic_periods WHERE id = $1 AND tenant_id = $2', [id, req.tenantId]);
  if (!p.rows.length) throw new HttpError(404, 'Période introuvable.');
  throw new HttpError(409, reason(p.rows[0]));
}

router.delete('/:id', requireWrite('periods'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query('DELETE FROM academic_periods WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL RETURNING id', [req.params.id, req.tenantId]);
  if (!r.rows.length) await missingOrConflict(req, req.params.id, () => 'Une période clôturée ne peut pas être supprimée.');
  await audit(req, { action: 'academic_period.delete', entity: 'academic_period', entityId: r.rows[0].id });
  res.json({ data: { id: r.rows[0].id } });
}));

// Clôture : irréversible ici (la réouverture exige motif et approbation, §5.2 — non implémentée).
router.post('/:id/close', requireRole('admin'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query(
    'UPDATE academic_periods SET closed_at = now(), closed_by = $3 WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL RETURNING id, name, closed_at',
    [req.params.id, req.tenantId, req.user.id]
  );
  if (!r.rows.length) await missingOrConflict(req, req.params.id, () => 'Cette période est déjà clôturée.');
  await audit(req, { action: 'academic_period.close', entity: 'academic_period', entityId: r.rows[0].id });
  res.json({ data: r.rows[0] });
}));

// Réouverture : administrateur, motif obligatoire, journalisée. Le motif et l'auteur restent enregistrés sur la période.
router.post('/:id/reopen', requireRole('admin', 'gerant'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const reason = req.body && req.body.reason;
  if (typeof reason !== 'string' || reason.trim().length < 5) throw new HttpError(400, 'Motif obligatoire (5 caractères minimum).');
  const r = await db.query(
    `UPDATE academic_periods
        SET closed_at = NULL, closed_by = NULL, reopened_at = now(), reopened_by = $3, reopen_reason = $4
      WHERE id = $1 AND tenant_id = $2 AND closed_at IS NOT NULL
      RETURNING id, name, reopened_at`,
    [req.params.id, req.tenantId, req.user.id, reason.trim()]
  );
  if (!r.rows.length) await missingOrConflict(req, req.params.id, () => 'Cette période n’est pas clôturée.');
  await audit(req, { action: 'academic_period.reopen', entity: 'academic_period', entityId: r.rows[0].id, details: { reason: reason.trim() } });
  res.json({ data: r.rows[0] });
}));

module.exports = router;
