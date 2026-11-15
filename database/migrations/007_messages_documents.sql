-- Migration 007 : messagerie et documents (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-02

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    title VARCHAR(255),
    type VARCHAR(50) DEFAULT 'private',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID,
    content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'envoye',
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50),
    class_id UUID,
    file_path VARCHAR(500),
    status VARCHAR(20) DEFAULT 'brouillon',
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
