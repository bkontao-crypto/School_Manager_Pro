-- 020 : photos d'élèves téléversées (stockées en base, donc incluses dans les sauvegardes). Une photo par élève.
CREATE TABLE IF NOT EXISTS student_photos (
  tenant_id  UUID NOT NULL,
  student_id UUID NOT NULL,
  photo      BYTEA NOT NULL,
  mime       VARCHAR(20) NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, student_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE
);
