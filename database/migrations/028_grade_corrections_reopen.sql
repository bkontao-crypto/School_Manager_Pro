-- 028 : corrections de notes validées (demande, décision administrateur, motif obligatoire) et réouverture de période avec motif (PH1-09).
-- Additive : une table, des index uniques, des colonnes nullables. Une seule demande en attente par note.
-- Retour arrière : DROP TABLE grade_corrections ; DROP INDEX grades_id_tenant_uniq ;
--                  ALTER TABLE academic_periods DROP CONSTRAINT academic_periods_reopened_by_fk, DROP COLUMN reopen_reason, DROP COLUMN reopened_by, DROP COLUMN reopened_at ;

CREATE UNIQUE INDEX IF NOT EXISTS grades_id_tenant_uniq ON grades (id, tenant_id);

CREATE TABLE IF NOT EXISTS grade_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  grade_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) >= 5),
  old_score NUMERIC(5,2) NOT NULL,
  new_score NUMERIC(5,2) NOT NULL CHECK (new_score >= 0 AND new_score <= 20),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by UUID,
  decided_at TIMESTAMP WITH TIME ZONE,
  decision_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT grade_corrections_grade_fk FOREIGN KEY (grade_id, tenant_id) REFERENCES grades (id, tenant_id),
  CONSTRAINT grade_corrections_requested_fk FOREIGN KEY (requested_by, tenant_id) REFERENCES users (id, tenant_id),
  CONSTRAINT grade_corrections_decided_fk FOREIGN KEY (decided_by, tenant_id) REFERENCES users (id, tenant_id),
  CONSTRAINT grade_corrections_decision_check CHECK (
    status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND char_length(btrim(decision_reason)) >= 5))
);

CREATE UNIQUE INDEX IF NOT EXISTS grade_corrections_one_pending ON grade_corrections (grade_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS grade_corrections_tenant_status ON grade_corrections (tenant_id, status);

ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS reopened_by UUID;
ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_reopened_by_fk') THEN
    ALTER TABLE academic_periods ADD CONSTRAINT academic_periods_reopened_by_fk
      FOREIGN KEY (reopened_by, tenant_id) REFERENCES users (id, tenant_id);
  END IF;
END $$;
