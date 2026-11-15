-- 019 : e-mails (journal d'envoi), rappels automatiques dédoublonnés, réinitialisation de mot de passe par e-mail,
-- réglages de facturation (TVA, mentions), remises / TVA / avoirs sur les factures, commentaires de bulletin.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL,
  to_email   VARCHAR(255) NOT NULL,
  subject    VARCHAR(300) NOT NULL,
  body_text  TEXT NOT NULL DEFAULT '',
  body_html  TEXT,
  kind       VARCHAR(40) NOT NULL DEFAULT 'other',
  ref        VARCHAR(200),
  status     VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_created ON mail_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_ref ON mail_outbox (ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_log (
  kind       VARCHAR(40) NOT NULL,
  ref        VARCHAR(200) NOT NULL,
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref)
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS document_type   VARCHAR(12) NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS credit_for      UUID REFERENCES subscription_invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS subtotal        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at    TIMESTAMPTZ;
UPDATE subscription_invoices SET subtotal = amount WHERE subtotal IS NULL;

ALTER TABLE subscription_invoices DROP CONSTRAINT IF EXISTS subscription_invoices_status_check;
ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_status_check CHECK (status IN ('pending', 'paid', 'cancelled', 'issued'));
DO $$ BEGIN
  ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_type_check CHECK (
    (document_type = 'invoice' AND credit_for IS NULL AND status <> 'issued')
    OR (document_type = 'credit_note' AND credit_for IS NOT NULL AND status = 'issued'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_tax_check CHECK (tax_rate >= 0 AND tax_rate <= 100 AND discount_amount >= 0 AND tax_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_sub_invoices_credit_for ON subscription_invoices (credit_for) WHERE credit_for IS NOT NULL;

-- Commentaires de bulletin : appréciation de l'enseignant et décision du conseil de classe, par élève et par période.
CREATE TABLE IF NOT EXISTS report_card_comments (
  tenant_id        UUID NOT NULL,
  student_id       UUID NOT NULL,
  period_key       VARCHAR(30) NOT NULL,
  teacher_comment  VARCHAR(600),
  council_decision VARCHAR(30) CHECK (council_decision IS NULL OR council_decision IN
    ('Félicitations', 'Encouragements', 'Tableau d’honneur', 'Avertissement travail', 'Avertissement conduite', 'Blâme')),
  updated_by       UUID,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, student_id, period_key),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
