-- 017 : espace superadmin (plateforme) : packs, licences, quotas, coordonnées et suspension des établissements.
CREATE TABLE IF NOT EXISTS plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(30) NOT NULL UNIQUE,
  name           VARCHAR(100) NOT NULL,
  description    VARCHAR(500),
  max_students   INTEGER CHECK (max_students IS NULL OR max_students > 0),  -- NULL = illimité
  max_users      INTEGER CHECK (max_users IS NULL OR max_users > 0),        -- NULL = illimité
  price_monthly  NUMERIC(12,2) CHECK (price_monthly IS NULL OR price_monthly >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plans (code, name, description, max_students, max_users, price_monthly) VALUES
  ('ESSENTIEL', 'Essentiel', 'Petite école : gestion des élèves, notes, paiements.', 300, 10, 15000),
  ('STANDARD',  'Standard',  'École complète : tous les modules.', 1000, 30, 35000),
  ('PREMIUM',   'Premium',   'Grand établissement ou groupe scolaire.', 5000, 100, 75000)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan_id          UUID REFERENCES plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contact_name     VARCHAR(150),
  ADD COLUMN IF NOT EXISTS contact_email    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS city             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS contract_ref     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS license_start    DATE,
  ADD COLUMN IF NOT EXISTS license_end      DATE,
  ADD COLUMN IF NOT EXISTS max_students     INTEGER,
  ADD COLUMN IF NOT EXISTS max_users        INTEGER,
  ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(300),
  ADD COLUMN IF NOT EXISTS notes            TEXT;

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_license_dates_check CHECK (license_end IS NULL OR license_start IS NULL OR license_end >= license_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_quota_check CHECK ((max_students IS NULL OR max_students > 0) AND (max_users IS NULL OR max_users > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_audit_logs_platform ON audit_logs (created_at DESC) WHERE tenant_id IS NULL;
