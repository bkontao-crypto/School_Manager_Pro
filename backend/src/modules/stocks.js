// Module Stocks.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'stock_item',
  table: 'stock_items',
  select: 'id, name, category, quantity, unit, threshold, status, created_at',
  orderBy: 'name',
  fields: {
    name: { type: 'string', required: true, max: 255 },
    category: { type: 'string', max: 100 },
    quantity: { type: 'int', min: 0, max: 10000000, default: 0 },
    unit: { type: 'string', max: 50 },
    threshold: { type: 'int', min: 0, max: 10000000, default: 0 },
    status: { type: 'enum', values: ['actif', 'inactif'] }
  },
  module: 'stocks'
});
