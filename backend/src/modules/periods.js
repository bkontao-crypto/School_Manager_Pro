// Périodes scolaires nommées (trimestres, semestres). Lecture : tous ; création et suppression : administrateur.

const db = require('../utils/db');
const { makeResource } = require('../utils/resource');
const { HttpError, wrap } = require('../utils/http');
const { isUuid } = require('../utils/validate');
const { requireWrite } = require('../utils/permissions');
const { audit } = require('../utils/audit');

const router = makeResource({
  entity: 'academic_period',
  table: 'academic_periods',
  select: "id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date",
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

router.delete('/:id', requireWrite('periods'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query('DELETE FROM academic_periods WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Période introuvable.');
  await audit(req, { action: 'academic_period.delete', entity: 'academic_period', entityId: r.rows[0].id });
  res.json({ data: { id: r.rows[0].id } });
}));

module.exports = router;
