-- Migration 008 : stocks et notifications (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-02

CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    quantity INTEGER DEFAULT 0,
    unit VARCHAR(50),
    threshold INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'actif',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    channel VARCHAR(50) DEFAULT 'interne',
    recipient VARCHAR(255),
    status VARCHAR(20) DEFAULT 'en_attente',
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_items_tenant ON stock_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
