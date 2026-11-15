-- ============================================================================
-- 013 · Durcissement du schéma (correctifs de l'audit du 2026-11-05, v2.4.0)
--
--  C3  tenant_id NOT NULL partout (plus de lignes orphelines)
--  M6  clés étrangères composites (tenant_id, id) : plus de lien entre établissements ;
--      tenant_id sur student_parents et class_teachers ; numéro de reçu unique PAR établissement
--  M7  unicité des présences même quand class_id est NULL
--  M3  vocabulaire de statuts des paiements unifié ; numéros de reçus générés par établissement
--  M11 suppression logique des élèves (deleted_at) ; audit_logs prêt à recevoir les actions
--  M5  règles de gestion (CHECK) : montants > 0, notes entre 0 et 20, statuts connus
--
-- Les CHECK de valeurs numériques sont posés en NOT VALID : ils s'appliquent aux nouvelles lignes
-- sans bloquer la migration si d'anciennes données les violent (à nettoyer puis VALIDATE CONSTRAINT).
-- Cette migration est exécutée dans une transaction par scripts/migrate.js : tout ou rien.
-- ============================================================================

-- 0. Garde-fou : refuser de continuer s'il existe des lignes sans établissement --------------
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['licenses','students','classes','parents','teachers','attendances','grades','payments',
                           'conversations','messages','documents','stock_items','notifications','staff','books',
                           'menus','transport_routes']
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Migration 013 : % ligne(s) de la table "%" n''ont pas de tenant_id. Rattachez-les a un etablissement (UPDATE) ou supprimez-les, puis relancez.', n, t;
    END IF;
  END LOOP;
END $$;

-- 1. tenant_id obligatoire -------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licenses','students','classes','parents','teachers','attendances','grades','payments',
                           'conversations','messages','documents','stock_items','notifications','staff','books',
                           'menus','transport_routes']
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', t);
  END LOOP;
END $$;

-- 2. Utilisateurs : rôles connus, superadmin sans établissement, e-mails uniques sans casse ----
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','admin','teacher','accountant','staff','parent','user')) NOT VALID;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_tenant_check;
ALTER TABLE users ADD CONSTRAINT users_role_tenant_check
  CHECK ((role = 'superadmin' AND tenant_id IS NULL) OR (role <> 'superadmin' AND tenant_id IS NOT NULL)) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_superadmin_email ON users (lower(email)) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_email ON users (tenant_id, lower(email)) WHERE tenant_id IS NOT NULL;

-- 3. Clés uniques composites servant de cibles aux clés étrangères ---------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['classes','students','parents','teachers','conversations']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_tenant_id_id_key' AND conrelid = t::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (tenant_id, id)', t, t || '_tenant_id_id_key');
    END IF;
  END LOOP;
END $$;

-- 4. Tables de liaison : ajout de tenant_id (déduit des tables liées) ------------------------
ALTER TABLE student_parents ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE student_parents sp SET tenant_id = s.tenant_id FROM students s WHERE s.id = sp.student_id AND sp.tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM student_parents sp JOIN parents p ON p.id = sp.parent_id WHERE p.tenant_id <> sp.tenant_id) THEN
    RAISE EXCEPTION 'Migration 013 : student_parents relie un eleve et un parent d''etablissements differents. Corrigez ces lignes puis relancez.';
  END IF;
END $$;
ALTER TABLE student_parents ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE class_teachers ADD COLUMN IF NOT EXISTS tenant_id UUID;
UPDATE class_teachers ct SET tenant_id = c.tenant_id FROM classes c WHERE c.id = ct.class_id AND ct.tenant_id IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM class_teachers ct JOIN teachers t ON t.id = ct.teacher_id WHERE t.tenant_id <> ct.tenant_id) THEN
    RAISE EXCEPTION 'Migration 013 : class_teachers relie une classe et un enseignant d''etablissements differents. Corrigez ces lignes puis relancez.';
  END IF;
END $$;
ALTER TABLE class_teachers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE student_parents DROP CONSTRAINT IF EXISTS student_parents_tenant_fk;
ALTER TABLE student_parents ADD CONSTRAINT student_parents_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE class_teachers DROP CONSTRAINT IF EXISTS class_teachers_tenant_fk;
ALTER TABLE class_teachers ADD CONSTRAINT class_teachers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

-- 5. Clés étrangères composites : un lien ne peut pas sortir de l'établissement ---------------
-- (NULL dans la colonne liée = pas de lien = pas de contrôle)
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_id_fkey;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_fk;
ALTER TABLE students ADD CONSTRAINT students_class_fk
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_student_id_fkey;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_student_fk;
ALTER TABLE attendances ADD CONSTRAINT attendances_student_fk
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_class_id_fkey;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_class_fk;
ALTER TABLE attendances ADD CONSTRAINT attendances_class_fk
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_student_id_fkey;
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_student_fk;
ALTER TABLE grades ADD CONSTRAINT grades_student_fk
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_student_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_student_fk;
ALTER TABLE payments ADD CONSTRAINT payments_student_fk
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE student_parents DROP CONSTRAINT IF EXISTS student_parents_student_id_fkey;
ALTER TABLE student_parents DROP CONSTRAINT IF EXISTS student_parents_student_fk;
ALTER TABLE student_parents ADD CONSTRAINT student_parents_student_fk
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE student_parents DROP CONSTRAINT IF EXISTS student_parents_parent_id_fkey;
ALTER TABLE student_parents DROP CONSTRAINT IF EXISTS student_parents_parent_fk;
ALTER TABLE student_parents ADD CONSTRAINT student_parents_parent_fk
  FOREIGN KEY (tenant_id, parent_id) REFERENCES parents (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE class_teachers DROP CONSTRAINT IF EXISTS class_teachers_class_id_fkey;
ALTER TABLE class_teachers DROP CONSTRAINT IF EXISTS class_teachers_class_fk;
ALTER TABLE class_teachers ADD CONSTRAINT class_teachers_class_fk
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE class_teachers DROP CONSTRAINT IF EXISTS class_teachers_teacher_id_fkey;
ALTER TABLE class_teachers DROP CONSTRAINT IF EXISTS class_teachers_teacher_fk;
ALTER TABLE class_teachers ADD CONSTRAINT class_teachers_teacher_fk
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_class_fk;
ALTER TABLE documents ADD CONSTRAINT documents_class_fk
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_fk;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_fk
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_fk;
ALTER TABLE messages ADD CONSTRAINT messages_sender_fk
  FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL NOT VALID;

-- 6. Présences : une seule ligne par élève, date et classe (class_id NULL compris) -----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM attendances
             GROUP BY student_id, date, COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
             HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Migration 013 : des presences en double existent (meme eleve, meme date, meme classe). Supprimez les doublons puis relancez.';
  END IF;
END $$;
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_student_id_class_id_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendances_student_class_date
  ON attendances (student_id, date, COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 7. Paiements : statuts, montants, numéros de reçu par établissement ------------------------
CREATE TABLE IF NOT EXISTS tenant_counters (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(50) NOT NULL,
    value BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, name)
);

UPDATE payments SET status = 'paye' WHERE status NOT IN ('paye', 'en_attente', 'annule');
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'paye';
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('paye', 'en_attente', 'annule'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount > 0) NOT VALID;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_receipt_number_key;
UPDATE payments p
   SET receipt_number = 'R-' || to_char(p.created_at, 'YYYY') || '-' || lpad(n.rn::text, 6, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM payments) n
 WHERE p.id = n.id AND p.receipt_number IS NULL;
INSERT INTO tenant_counters (tenant_id, name, value)
  SELECT tenant_id, 'receipt', count(*) FROM payments GROUP BY tenant_id
  ON CONFLICT (tenant_id, name) DO UPDATE SET value = GREATEST(tenant_counters.value, EXCLUDED.value);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_tenant_receipt_key;
ALTER TABLE payments ADD CONSTRAINT payments_tenant_receipt_key UNIQUE (tenant_id, receipt_number);

-- 8. Notes -----------------------------------------------------------------------------------
UPDATE grades SET status = 'saisie' WHERE status NOT IN ('saisie', 'validee', 'annulee');
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_status_check;
ALTER TABLE grades ADD CONSTRAINT grades_status_check CHECK (status IN ('saisie', 'validee', 'annulee'));
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_score_check;
-- Barème sur 20 (usage au Mali). Pour un autre barème : retirer cette contrainte puis adapter validate.js (modules/grades.js).
ALTER TABLE grades ADD CONSTRAINT grades_score_check CHECK (score >= 0 AND score <= 20) NOT VALID;
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_coefficient_check;
ALTER TABLE grades ADD CONSTRAINT grades_coefficient_check CHECK (coefficient > 0) NOT VALID;

-- 9. Élèves : suppression logique + statuts connus --------------------------------------------
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE students SET status = 'active' WHERE status NOT IN ('active', 'inactive', 'suspended', 'graduated', 'transferred');
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('active', 'inactive', 'suspended', 'graduated', 'transferred'));

-- 10. Autres règles de gestion ----------------------------------------------------------------
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_max_students_check;
ALTER TABLE classes ADD CONSTRAINT classes_max_students_check CHECK (max_students IS NULL OR max_students > 0) NOT VALID;
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_quantity_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_quantity_check CHECK (quantity >= 0 AND threshold >= 0) NOT VALID;
ALTER TABLE transport_routes DROP CONSTRAINT IF EXISTS transport_routes_capacity_check;
ALTER TABLE transport_routes ADD CONSTRAINT transport_routes_capacity_check CHECK (capacity > 0) NOT VALID;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check CHECK (status IN ('brouillon', 'publie', 'archive')) NOT VALID;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('en_attente', 'envoye', 'echec')) NOT VALID;

-- 11. Journal d'audit -------------------------------------------------------------------------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id UUID;
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);

-- 12. Index composites pour les listes et le tableau de bord ---------------------------------
CREATE INDEX IF NOT EXISTS idx_students_tenant_name ON students (tenant_id, last_name, first_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendances_tenant_date ON attendances (tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_paid ON payments (tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_grades_tenant_created ON grades (tenant_id, created_at DESC);

-- 13. updated_at maintenu automatiquement ------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
