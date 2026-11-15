-- Migration 003 : parents et relations (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-01

CREATE TABLE IF NOT EXISTS parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES parents(id) ON DELETE RESTRICT,
    relationship VARCHAR(50),
    is_primary BOOLEAN DEFAULT FALSE,
    UNIQUE(student_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_parents_tenant ON parents(tenant_id);
