// Module Enseignants.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'teacher',
  table: 'teachers',
  select: 'id, matricule, first_name, last_name, email, specialties, status, created_at',
  orderBy: 'last_name, first_name',
  fields: {
    matricule: { type: 'string', max: 50 },
    first_name: { type: 'string', required: true, max: 100 },
    last_name: { type: 'string', required: true, max: 100 },
    email: { type: 'string', max: 255, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'Adresse e-mail invalide' },
    specialties: { type: 'stringArray', maxItems: 20 },
    status: { type: 'enum', values: ['active', 'inactive'] }
  },
  module: 'teachers'
});
