-- Migration 030 (additive) — ordonnance §4.4 (documents) et §14.3 (approbations).
--  1. Retrait d'une demande de correction de note par son auteur (statut « withdrawn »). La décision de retrait
--     reste tracée par decided_by / decided_at / decision_reason (contrainte grade_corrections_decision_check).
--  2. Documents : stockage privé. Colonnes ajoutées ; file_path (texte libre historique) n'est plus alimenté.
--  Retour arrière : supprimer les colonnes ajoutées et restaurer la contrainte de statut à (pending, approved, rejected).

ALTER TABLE grade_corrections DROP CONSTRAINT IF EXISTS grade_corrections_status_check;
ALTER TABLE grade_corrections ADD CONSTRAINT grade_corrections_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_name VARCHAR(80);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 CHAR(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_size_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_size_check CHECK (size_bytes IS NULL OR size_bytes > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_uploaded_by_fk') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_uploaded_by_fk FOREIGN KEY (uploaded_by, tenant_id) REFERENCES users (id, tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_storage_name_key') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_storage_name_key UNIQUE (storage_name);
  END IF;
END $$;
