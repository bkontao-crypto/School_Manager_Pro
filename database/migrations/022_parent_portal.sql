-- 022 : portail parent. Un compte utilisateur (rôle « parent ») est lié à UNE fiche responsable ;
-- il ne voit que les élèves rattachés à ce responsable (student_parents). Un responsable a au plus un compte.
CREATE TABLE IF NOT EXISTS parent_accounts (
  tenant_id  UUID NOT NULL,
  parent_id  UUID NOT NULL,
  user_id    UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, parent_id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES parents (tenant_id, id) ON DELETE CASCADE
);
