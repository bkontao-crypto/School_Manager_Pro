// Module Notes (barème sur 20, cohérent avec la contrainte grades_score_check de la migration 013).

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'grade',
  table: 'grades',
  from: `grades g JOIN students s ON s.id = g.student_id AND s.tenant_id = g.tenant_id`,
  tenantCol: 'g.tenant_id',
  select: `g.id, g.student_id, s.first_name || ' ' || s.last_name AS student_name, g.subject, g.evaluation_type,
           g.score, g.coefficient, g.date, g.status`,
  orderBy: 'g.created_at DESC',
  filters: {
    student_id: { type: 'uuid', column: 'g.student_id' },
    status: { type: 'enum', values: ['saisie', 'validee', 'annulee'], column: 'g.status' }
  },
  fields: {
    student_id: { type: 'uuid', required: true },
    subject: { type: 'string', required: true, max: 100 },
    evaluation_type: { type: 'string', max: 50 },
    score: { type: 'number', required: true, min: 0, max: 20 },
    coefficient: { type: 'number', exclusiveMin: 0, max: 20, default: 1 },
    date: { type: 'date' },
    status: { type: 'enum', values: ['saisie', 'validee', 'annulee'] }
  },
  module: 'grades',
  exportCsv: { filename: 'notes.csv', columns: [['student_name', 'Élève'], ['subject', 'Matière'], ['evaluation_type', 'Évaluation'], ['score', 'Note /20'], ['coefficient', 'Coefficient'], ['date', 'Date'], ['status', 'Statut']] }
});
