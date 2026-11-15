-- 024 : rappels d'impayés aux parents (paiements « en_attente »).
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS unpaid_channels   TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unpaid_after_days INTEGER NOT NULL DEFAULT 7 CHECK (unpaid_after_days BETWEEN 1 AND 90);

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_audience_type_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_audience_type_check CHECK (audience_type IN ('all', 'class', 'student', 'unpaid'));
