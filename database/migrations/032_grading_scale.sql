-- Migration 032 (additive) — ordonnance §5.1 : barème des notes configurable par établissement.
--  - tenants.grade_scale_max : barème de l'établissement, 10 ou 20 (défaut 20 : comportement historique).
--  - Trigger sur grades : aucune note ne peut dépasser le barème de son établissement, quel que soit le chemin d'écriture.
--    La contrainte grades_score_check (0..20, migration 013) reste en place.
--  Retour arrière : DROP TRIGGER grades_scale_check ON grades ; DROP FUNCTION grades_check_scale() ; ALTER TABLE tenants DROP COLUMN grade_scale_max.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grade_scale_max SMALLINT NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_grade_scale_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_grade_scale_check CHECK (grade_scale_max IN (10, 20));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION grades_check_scale() RETURNS trigger AS $$
DECLARE
  scale_max SMALLINT;
BEGIN
  SELECT grade_scale_max INTO scale_max FROM tenants WHERE id = NEW.tenant_id;
  IF NEW.score > COALESCE(scale_max, 20) THEN
    RAISE EXCEPTION 'La note dépasse le barème de l’établissement (sur %).', COALESCE(scale_max, 20)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS grades_scale_check ON grades;
CREATE TRIGGER grades_scale_check
  BEFORE INSERT OR UPDATE OF score, tenant_id ON grades
  FOR EACH ROW EXECUTE FUNCTION grades_check_scale();
