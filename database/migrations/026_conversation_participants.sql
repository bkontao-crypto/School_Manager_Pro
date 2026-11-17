-- 026 : participants des conversations (ordonnance §4.1, confidentialité de la messagerie).
-- Additive : ne supprime ni ne modifie aucune donnée existante.
-- Reprise : chaque expéditeur d'un message existant devient participant de sa conversation,
-- afin que personne ne perde l'accès à une conversation déjà utilisée. Aucun accès n'est ajouté.
-- Retour arrière : DROP TABLE conversation_participants; (les conversations et messages ne sont pas touchés)

CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_tenant_uniq ON conversations (id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_id_tenant_uniq ON users (id, tenant_id);

CREATE TABLE IF NOT EXISTS conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    user_id UUID NOT NULL,
    is_manager BOOLEAN NOT NULL DEFAULT FALSE,
    added_by UUID,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT conversation_participants_conv_fk
        FOREIGN KEY (conversation_id, tenant_id) REFERENCES conversations (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT conversation_participants_user_fk
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT conversation_participants_unique UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON conversation_participants (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS conversation_participants_tenant_idx ON conversation_participants (tenant_id);

INSERT INTO conversation_participants (tenant_id, conversation_id, user_id)
SELECT DISTINCT m.tenant_id, m.conversation_id, m.sender_id
FROM messages m
JOIN users u ON u.id = m.sender_id AND u.tenant_id = m.tenant_id
WHERE m.sender_id IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO NOTHING;
