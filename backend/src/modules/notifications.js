// Module Notifications (enregistrement interne ; l'envoi SMS/e-mail réel reste à brancher, voir ROADMAP).

const { makeResource } = require('../utils/resource');

module.exports = makeResource({
  entity: 'notification',
  table: 'notifications',
  select: 'id, title, message, channel, recipient, status, sent_at, created_at',
  orderBy: 'created_at DESC',
  fields: {
    title: { type: 'string', required: true, max: 255 },
    message: { type: 'text', max: 2000 },
    channel: { type: 'enum', values: ['interne', 'sms', 'email'], default: 'interne' },
    recipient: { type: 'string', max: 255 }
  },
  module: 'notifications'
});
