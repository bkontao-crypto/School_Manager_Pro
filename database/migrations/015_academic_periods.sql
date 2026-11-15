-- 015 : périodes scolaires nommées (trimestres, semestres) utilisées pour filtrer les bulletins.
CREATE TABLE IF NOT EXISTS academic_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT academic_periods_dates_check CHECK (end_date >= start_date),
  CONSTRAINT academic_periods_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_academic_periods_tenant_start ON academic_periods (tenant_id, start_date);
