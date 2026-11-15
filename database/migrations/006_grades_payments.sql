-- Migration 006 : notes et paiements (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-02

CREATE TABLE IF NOT EXISTS grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
    subject VARCHAR(100),
    evaluation_type VARCHAR(50),
    score DECIMAL(5,2),
    coefficient DECIMAL(3,2) DEFAULT 1.0,
    date DATE,
    status VARCHAR(20) DEFAULT 'saisie',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
    amount DECIMAL(12,2) NOT NULL,
    fee_type VARCHAR(50),
    method VARCHAR(50),
    receipt_number VARCHAR(50) UNIQUE,
    status VARCHAR(20) DEFAULT 'enregistre',
    paid_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grades_tenant ON grades(tenant_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
