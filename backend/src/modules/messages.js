// Messagerie interne : conversations et messages (tous les utilisateurs connectés de l'établissement peuvent écrire).
// Routes : GET/POST /api/messages/conversations · GET/POST /api/messages/messages (?conversation_id= obligatoire en lecture)

const express = require('express');
const { makeResource } = require('../utils/resource');

const router = express.Router();

router.use('/conversations', makeResource({
  entity: 'conversation',
  table: 'conversations',
  select: 'id, title, type, created_at',
  orderBy: 'created_at DESC',
  fields: {
    title: { type: 'string', max: 255 },
    type: { type: 'enum', values: ['private', 'group'], default: 'private' }
  },
  module: 'messages'
}));

router.use('/messages', makeResource({
  entity: 'message',
  table: 'messages',
  from: 'messages m LEFT JOIN users u ON u.id = m.sender_id',
  tenantCol: 'm.tenant_id',
  select: 'm.id, m.conversation_id, m.sender_id, u.full_name AS sender_name, m.content, m.status, m.sent_at',
  orderBy: 'm.sent_at DESC',
  filters: { conversation_id: { type: 'uuid', column: 'm.conversation_id' } },
  requireFilters: ['conversation_id'],
  fields: {
    conversation_id: { type: 'uuid', required: true },
    content: { type: 'text', required: true, max: 5000 }
  },
  defaults: (req) => ({ sender_id: req.user.id }),
  module: 'messages'
}));

module.exports = router;
