-- Migration 010 : bibliothèque et cantine (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-03

CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255),
    isbn VARCHAR(50),
    available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    date DATE NOT NULL,
    items TEXT[],
    status VARCHAR(20) DEFAULT 'planifie',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_books_tenant ON books(tenant_id);
CREATE INDEX IF NOT EXISTS idx_menus_tenant ON menus(tenant_id);
