-- Migration 011 : transport (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-03

CREATE TABLE IF NOT EXISTS transport_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    vehicle VARCHAR(100),
    capacity INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'actif',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_routes_tenant ON transport_routes(tenant_id);
