-- Migration 033 (corrective, additive + reprise de données) — ordonnance §4.5 et §20 (bulletins traçables).
-- Contexte : avant la Phase 1, les notes n'avaient pas de circuit de validation. Elles sont restées en 'saisie' ;
-- les bulletins ne retiennent que les notes 'validee' : sans cette reprise, les bulletins existants seraient vides.
--  - Chaque note 'saisie' existante passe à 'validee' (décision de l'établissement : option 1).
--  - Le statut d'origine de chaque note reprise est conservé dans grades_status_backfill_033 (retour arrière exact).
--  - Une entrée d'audit par établissement concerné (action grade.backfill_validated, sans utilisateur).
--  - Les notes créées après cette migration suivent le circuit normal (saisie → validee par l'administrateur).
-- Retour arrière : UPDATE grades g SET status = b.previous_status FROM grades_status_backfill_033 b
--                  WHERE b.grade_id = g.id AND g.status = 'validee' ; DROP TABLE grades_status_backfill_033 ;
-- Idempotence : la sélection porte sur 'saisie' uniquement ; une seconde exécution ne reprend rien.

CREATE TABLE IF NOT EXISTS grades_status_backfill_033 (
  grade_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  previous_status VARCHAR(20) NOT NULL,
  backfilled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TEMP TABLE reprises_033 AS
  SELECT id AS grade_id, tenant_id, status AS previous_status FROM grades WHERE status = 'saisie';

INSERT INTO grades_status_backfill_033 (grade_id, tenant_id, previous_status)
  SELECT grade_id, tenant_id, previous_status FROM reprises_033
  ON CONFLICT (grade_id) DO NOTHING;

UPDATE grades g SET status = 'validee'
  FROM reprises_033 r
  WHERE r.grade_id = g.id AND g.status = 'saisie';

INSERT INTO audit_logs (tenant_id, user_id, action, entity, details)
  SELECT tenant_id, NULL, 'grade.backfill_validated', 'grade',
         jsonb_build_object('count', count(*), 'migration', '033', 'reason', 'notes antérieures à la validation')
  FROM reprises_033
  GROUP BY tenant_id;

DROP TABLE reprises_033;
