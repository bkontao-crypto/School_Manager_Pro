// Module Ressources humaines (personnel non enseignant).

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'staff',
  table: 'staff',
  select: 'id, first_name, last_name, position, department, status, hire_date, created_at',
  orderBy: 'last_name, first_name',
  fields: {
    first_name: { type: 'string', required: true, max: 100 },
    last_name: { type: 'string', required: true, max: 100 },
    position: { type: 'string', max: 100 },
    department: { type: 'string', max: 100 },
    status: { type: 'enum', values: ['actif', 'inactif'] },
    hire_date: { type: 'date' }
  },
  module: 'hr'
});
