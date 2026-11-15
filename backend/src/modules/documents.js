// Module Documents.

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'document',
  table: 'documents',
  select: 'id, title, type, class_id, file_path, status, published_at, created_at',
  orderBy: 'created_at DESC',
  filters: { class_id: { type: 'uuid' }, status: { type: 'enum', values: ['brouillon', 'publie', 'archive'] } },
  fields: {
    title: { type: 'string', required: true, max: 255 },
    type: { type: 'string', max: 100 },
    class_id: { type: 'uuid', nullable: true },
    file_path: { type: 'string', max: 500 },
    status: { type: 'enum', values: ['brouillon', 'publie', 'archive'] }
  },
  module: 'documents'
});
