// Module Présences : une seule présence par élève, date et classe (index unique de la migration 013).

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'attendance',
  table: 'attendances',
  from: `attendances a JOIN students s ON s.id = a.student_id AND s.tenant_id = a.tenant_id`,
  tenantCol: 'a.tenant_id',
  select: `a.id, a.student_id, s.first_name || ' ' || s.last_name AS student_name, a.class_id, a.date, a.status, a.notes`,
  orderBy: 'a.date DESC, s.last_name',
  filters: {
    student_id: { type: 'uuid', column: 'a.student_id' },
    class_id: { type: 'uuid', column: 'a.class_id' },
    date: { type: 'date', column: 'a.date' },
    status: { type: 'enum', values: ['present', 'absent', 'late', 'justified'], column: 'a.status' }
  },
  fields: {
    student_id: { type: 'uuid', required: true },
    class_id: { type: 'uuid', nullable: true },
    date: { type: 'date', required: true },
    status: { type: 'enum', values: ['present', 'absent', 'late', 'justified'], required: true },
    notes: { type: 'text', max: 500, nullable: true }
  },
  module: 'attendances',
  afterCreate: (req, row) => (row.status === 'absent' ? require('../utils/notify').notifyAbsence(req.tenantId, row.student_id, row.date) : null)
});
