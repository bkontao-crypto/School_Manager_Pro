// Emploi du temps : créneaux hebdomadaires par classe.
// Un créneau est refusé (409) s'il chevauche un autre créneau de la même classe, du même enseignant ou dans la même salle.
// Routes : GET /api/timetable?class_id=&teacher_id=&day_of_week= · POST (admin) · DELETE /:id (admin)

const db = require('../utils/db');
const { makeResource } = require('../utils/resource');
const { HttpError, wrap } = require('../utils/http');
const { isUuid } = require('../utils/validate');
const { requireWrite } = require('../utils/permissions');
const { audit } = require('../utils/audit');

async function createSlot(req, v) {
  if (v.end_time <= v.start_time) throw new HttpError(400, 'Données invalides', { errors: [{ field: 'end_time', message: 'L’heure de fin doit suivre l’heure de début' }] });
  const clash = await db.query(
    `SELECT class_id = $3 AS same_class, ($6::uuid IS NOT NULL AND teacher_id = $6::uuid) AS same_teacher
       FROM timetable_slots
      WHERE tenant_id = $1 AND day_of_week = $2 AND start_time < $5 AND end_time > $4
        AND (class_id = $3 OR ($6::uuid IS NOT NULL AND teacher_id = $6::uuid) OR ($7::text IS NOT NULL AND lower(btrim(room)) = $7::text))
      ORDER BY (class_id = $3) DESC
      LIMIT 1`,
    [req.tenantId, v.day_of_week, v.class_id, v.start_time, v.end_time, v.teacher_id || null, v.room ? String(v.room).trim().toLowerCase() : null]
  );
  if (clash.rows.length) {
    const c = clash.rows[0];
    throw new HttpError(409, c.same_class ? 'Cette classe a déjà un cours sur ce créneau.' : c.same_teacher ? 'Cet enseignant a déjà un cours sur ce créneau.' : 'Cette salle est déjà occupée sur ce créneau.');
  }
  const result = await db.query(
    `INSERT INTO timetable_slots (tenant_id, class_id, teacher_id, subject, day_of_week, start_time, end_time, room)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.tenantId, v.class_id, v.teacher_id || null, v.subject, v.day_of_week, v.start_time, v.end_time, v.room || null]
  );
  return result.rows[0];
}

const router = makeResource({
  entity: 'timetable_slot',
  table: 'timetable_slots',
  from: `timetable_slots s
         JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id
         LEFT JOIN teachers t ON t.tenant_id = s.tenant_id AND t.id = s.teacher_id`,
  tenantCol: 's.tenant_id',
  select: `s.id, s.class_id, c.name AS class_name, s.teacher_id, t.first_name || ' ' || t.last_name AS teacher_name,
           s.subject, s.day_of_week, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time, s.room`,
  orderBy: 's.day_of_week, s.start_time',
  filters: {
    class_id: { type: 'uuid', column: 's.class_id' },
    teacher_id: { type: 'uuid', column: 's.teacher_id' },
    day_of_week: { type: 'int', min: 1, max: 7, column: 's.day_of_week' }
  },
  fields: {
    class_id: { type: 'uuid', required: true },
    teacher_id: { type: 'uuid', nullable: true },
    subject: { type: 'string', required: true, max: 100 },
    day_of_week: { type: 'int', required: true, min: 1, max: 7 },
    start_time: { type: 'time', required: true },
    end_time: { type: 'time', required: true },
    room: { type: 'string', max: 50 }
  },
  module: 'timetable',
  create: createSlot
});

router.delete('/:id', requireWrite('timetable'), wrap(async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(400, 'Identifiant invalide.');
  const r = await db.query('DELETE FROM timetable_slots WHERE id = $1 AND tenant_id = $2 RETURNING id', [req.params.id, req.tenantId]);
  if (!r.rows.length) throw new HttpError(404, 'Créneau introuvable.');
  await audit(req, { action: 'timetable_slot.delete', entity: 'timetable_slot', entityId: r.rows[0].id });
  res.json({ data: { id: r.rows[0].id } });
}));

module.exports = router;
