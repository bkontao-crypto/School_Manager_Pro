// Module Classes.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'class',
  table: 'classes',
  select: 'id, name, level, school_year, max_students, created_at',
  orderBy: 'name',
  fields: {
    name: { type: 'string', required: true, max: 100 },
    level: { type: 'string', max: 50 },
    school_year: { type: 'string', max: 20 },
    max_students: { type: 'int', exclusiveMin: 0, max: 500 }
  },
  module: 'classes'
});
