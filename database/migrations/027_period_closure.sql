-- 027 : clôture des périodes scolaires (ordonnance §5.2 ; PH1-09).
-- Additive : deux colonnes nullables et une clé étrangère composite vers users (même établissement).
-- Une période clôturée verrouille la création et la validation des notes dont la date tombe dans sa plage (contrôle applicatif).
-- Retour arrière : ALTER TABLE academic_periods DROP CONSTRAINT academic_periods_closed_by_fk, DROP COLUMN closed_by, DROP COLUMN closed_at;

ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS closed_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_closed_by_fk') THEN
    ALTER TABLE academic_periods ADD CONSTRAINT academic_periods_closed_by_fk
      FOREIGN KEY (closed_by, tenant_id) REFERENCES users (id, tenant_id);
  END IF;
END $$;
