-- Migration 009 : RH et statistiques de base (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-03

CREATE TABLE IF NOT EXISTS staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    position VARCHAR(100),
    department VARCHAR(100),
    status VARCHAR(20) DEFAULT 'actif',
    hire_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(tenant_id);
