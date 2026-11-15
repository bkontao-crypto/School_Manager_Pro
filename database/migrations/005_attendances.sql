-- Migration 005 : présences (Phase 3 - proposition)
-- SCHOOL MANAGER PRO
-- Date : 2026-11-02

CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    student_id UUID REFERENCES students(id) ON DELETE RESTRICT,
    class_id UUID REFERENCES classes(id) ON DELETE RESTRICT,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'justified')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(student_id, class_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendances_tenant ON attendances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendances_student ON attendances(student_id);
CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(date);
