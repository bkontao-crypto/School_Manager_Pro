// Module Transport scolaire.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'transport_route',
  table: 'transport_routes',
  select: 'id, name, vehicle, capacity, status, created_at',
  orderBy: 'name',
  fields: {
    name: { type: 'string', required: true, max: 255 },
    vehicle: { type: 'string', max: 100 },
    capacity: { type: 'int', exclusiveMin: 0, max: 200, default: 30 },
    status: { type: 'enum', values: ['actif', 'inactif'] }
  },
  module: 'transport'
});
