// Module Bibliothèque.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'book',
  table: 'books',
  select: 'id, title, author, isbn, available, created_at',
  orderBy: 'title',
  fields: {
    title: { type: 'string', required: true, max: 255 },
    author: { type: 'string', max: 255 },
    isbn: { type: 'string', max: 30 },
    available: { type: 'boolean', default: true }
  },
  module: 'library'
});
