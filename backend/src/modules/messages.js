// Messagerie interne : conversations et messages, réservés aux participants de chaque conversation (ordonnance §4.1).
// Règles (décision D3, option A) :
//  - l'administrateur de l'établissement voit toutes les conversations de son établissement et peut y écrire ;
//  - un utilisateur ne voit que les conversations auxquelles il participe ; une conversation inaccessible est traitée comme inexistante (404) ;
//  - le créateur d'une nouvelle conversation en devient participant gestionnaire ;
//  - les conversations antérieures n'ont pour participants que leurs expéditeurs connus (migration 026).
// Routes : GET/POST /api/messages/conversations · GET/POST /api/messages/messages (?conversation_id= obligatoire en lecture)

const express = require('express');
const db = require('../utils/db');
const { HttpError } = require('../utils/http');
const { makeResource } = require('../utils/resource');

const router = express.Router();
const isAdmin = (req) => req.user.role === 'admin';

// Clause SQL : l'utilisateur courant participe à la conversation désignée par l'expression donnée.
const participantOf = (conversationExpr, req, ph) => `EXISTS (
  SELECT 1 FROM conversation_participants cp
  WHERE cp.conversation_id = ${conversationExpr} AND cp.tenant_id = ${ph(req.tenantId)} AND cp.user_id = ${ph(req.user.id)})`;

router.use('/conversations', makeResource({
  entity: 'conversation',
  table: 'conversations',
  select: 'id, title, type, created_at',
  orderBy: 'created_at DESC',
  scope: (req, ph) => (isAdmin(req) ? null : participantOf('conversations.id', req, ph)),
  fields: {
    title: { type: 'string', max: 255 },
    type: { type: 'enum', values: ['private', 'group'], default: 'private' }
  },
  // Création et ajout du créateur comme participant gestionnaire, dans une seule transaction.
  create: (req, all) => db.withTransaction(async (client) => {
    const conv = await client.query(
      'INSERT INTO conversations (tenant_id, title, type) VALUES ($1, $2, $3) RETURNING id, title, type, created_at',
      [req.tenantId, all.title || null, all.type || 'private']
    );
    const row = conv.rows[0];
    await client.query(
      'INSERT INTO conversation_participants (tenant_id, conversation_id, user_id, is_manager, added_by) VALUES ($1, $2, $3, TRUE, $3)',
      [req.tenantId, row.id, req.user.id]
    );
    return row;
  }),
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
  scope: (req, ph) => (isAdmin(req) ? null : participantOf('m.conversation_id', req, ph)),
  fields: {
    conversation_id: { type: 'uuid', required: true },
    content: { type: 'text', required: true, max: 5000 }
  },
  // Envoi : la conversation doit appartenir à l'établissement et l'expéditeur doit y participer (sauf administrateur).
  create: async (req, all) => {
    const conv = await db.query('SELECT 1 FROM conversations WHERE id = $1 AND tenant_id = $2', [all.conversation_id, req.tenantId]);
    if (!conv.rows.length) throw new HttpError(404, 'Conversation introuvable.');
    if (!isAdmin(req)) {
      const member = await db.query(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND tenant_id = $2 AND user_id = $3',
        [all.conversation_id, req.tenantId, req.user.id]
      );
      if (!member.rows.length) throw new HttpError(404, 'Conversation introuvable.');
    }
    const result = await db.query(
      'INSERT INTO messages (tenant_id, conversation_id, sender_id, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.tenantId, all.conversation_id, req.user.id, all.content]
    );
    return result.rows[0];
  },
  module: 'messages'
}));

module.exports = router;
