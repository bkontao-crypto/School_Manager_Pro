-- Migration 004 : enseignants et affectations (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-02

CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    matricule VARCHAR(50),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    specialties TEXT[],
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, matricule)
);

CREATE TABLE IF NOT EXISTS class_teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID REFERENCES classes(id) ON DELETE RESTRICT,
    teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
    subject VARCHAR(100),
    is_main BOOLEAN DEFAULT FALSE,
    UNIQUE(class_id, teacher_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_teachers_tenant ON teachers(tenant_id);
