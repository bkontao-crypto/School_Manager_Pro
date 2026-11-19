-- Migration 031 (additive) — ordonnance §4.1 point 6 et §8.4 : accusés de réception et de lecture.
--  - Une ligne par destinataire et par message, créée à l'envoi à partir des participants présents à ce moment-là.
--  - delivered_at : le destinataire a reçu la conversation (POST /conversations/:id/receive).
--  - read_at      : le destinataire a lu la conversation (POST /conversations/:id/read).
--  L'expéditeur ne reçoit que des compteurs, jamais l'identité des lecteurs.
--  Retour arrière : DROP TABLE message_receipts ; DROP INDEX messages_id_tenant_uniq.

CREATE UNIQUE INDEX IF NOT EXISTS messages_id_tenant_uniq ON messages (id, tenant_id);

CREATE TABLE IF NOT EXISTS message_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  message_id UUID NOT NULL,
  user_id UUID NOT NULL,
  delivered_at TIMESTAMP WITH TIME ZONE,
  read_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT message_receipts_message_fk FOREIGN KEY (message_id, tenant_id) REFERENCES messages (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT message_receipts_user_fk FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
  CONSTRAINT message_receipts_unique UNIQUE (message_id, user_id),
  CONSTRAINT message_receipts_order_check CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS message_receipts_user_idx ON message_receipts (tenant_id, user_id) WHERE read_at IS NULL;
