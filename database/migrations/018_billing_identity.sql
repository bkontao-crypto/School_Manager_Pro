-- 018 : facturation des abonnements (factures de l'éditeur aux établissements) et identité personnalisable
-- (nom, slogan, logo) au niveau plateforme et par établissement.
CREATE TABLE IF NOT EXISTS platform_counters (
  name   VARCHAR(40) PRIMARY KEY,
  value  BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  number           VARCHAR(30) NOT NULL UNIQUE,
  plan_id          UUID REFERENCES plans(id) ON DELETE SET NULL,
  description      VARCHAR(300) NOT NULL,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  months           INTEGER NOT NULL CHECK (months BETWEEN 1 AND 60),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status           VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  due_date         DATE NOT NULL,
  paid_at          DATE,
  payment_method   VARCHAR(40),
  payment_ref      VARCHAR(100),
  license_extended BOOLEAN NOT NULL DEFAULT FALSE,
  notes            VARCHAR(500),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_invoices_period_check CHECK (period_end >= period_start),
  CONSTRAINT subscription_invoices_paid_check CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_tenant ON subscription_invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status ON subscription_invoices (status, due_date);

-- Identité : une ligne par établissement, et une ligne unique pour la plateforme.
CREATE TABLE IF NOT EXISTS tenant_identity (
  tenant_id    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  app_name     VARCHAR(60),
  slogan       VARCHAR(120),
  logo         BYTEA,
  logo_mime    VARCHAR(30),
  logo_width   INTEGER,
  logo_height  INTEGER,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_identity_logo_check CHECK (
    (logo IS NULL AND logo_mime IS NULL AND logo_width IS NULL AND logo_height IS NULL)
    OR (logo IS NOT NULL AND logo_mime IN ('image/png','image/jpeg','image/webp') AND logo_width > 0 AND logo_height > 0)),
  CONSTRAINT tenant_identity_size_check CHECK (logo IS NULL OR octet_length(logo) <= 524288)
);
CREATE TABLE IF NOT EXISTS platform_identity (
  singleton    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  app_name     VARCHAR(60),
  slogan       VARCHAR(120),
  logo         BYTEA,
  logo_mime    VARCHAR(30),
  logo_width   INTEGER,
  logo_height  INTEGER,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_identity_logo_check CHECK (
    (logo IS NULL AND logo_mime IS NULL AND logo_width IS NULL AND logo_height IS NULL)
    OR (logo IS NOT NULL AND logo_mime IN ('image/png','image/jpeg','image/webp') AND logo_width > 0 AND logo_height > 0)),
  CONSTRAINT platform_identity_size_check CHECK (logo IS NULL OR octet_length(logo) <= 524288)
);
