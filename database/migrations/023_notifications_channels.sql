-- 023 : notifications aux parents par SMS, WhatsApp et e-mail.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS notify_email    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_sms      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_whatsapp BOOLEAN NOT NULL DEFAULT TRUE;

-- Journal des SMS / WhatsApp (les e-mails restent dans mail_outbox).
CREATE TABLE IF NOT EXISTS notify_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants (id) ON DELETE CASCADE,
  channel     VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'whatsapp')),
  to_phone    VARCHAR(32) NOT NULL,
  body        TEXT NOT NULL,
  kind        VARCHAR(40) NOT NULL DEFAULT 'other',
  ref         VARCHAR(200),
  status      VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  provider_id VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notify_outbox_tenant ON notify_outbox (tenant_id, created_at DESC);

-- Messages groupés envoyés aux responsables (historique).
CREATE TABLE IF NOT EXISTS broadcasts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  created_by    UUID,
  audience_type VARCHAR(20) NOT NULL CHECK (audience_type IN ('all', 'class', 'student')),
  audience_id   UUID,
  audience_label VARCHAR(200),
  subject       VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  channels      TEXT[] NOT NULL,
  recipients    INTEGER NOT NULL DEFAULT 0,
  sent          INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts (tenant_id, created_at DESC);

-- Réglages par établissement : canaux de l'alerte automatique d'absence.
CREATE TABLE IF NOT EXISTS notification_settings (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  absence_channels TEXT[] NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
