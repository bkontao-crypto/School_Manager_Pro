// Module Cantine : un menu par date et par établissement.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'menu',
  table: 'menus',
  select: 'id, date, items, status, created_at',
  orderBy: 'date DESC',
  fields: {
    date: { type: 'date', required: true },
    items: { type: 'stringArray', maxItems: 30 },
    status: { type: 'enum', values: ['planifie', 'servi', 'annule'] }
  },
  module: 'canteen'
});
