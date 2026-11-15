-- 021 : permissions par module et par rôle, propres à chaque établissement.
-- Une ligne = une dérogation à la matrice par défaut (absence de ligne = comportement par défaut).
-- Le rôle « admin » a toujours tous les droits et n'est pas configurable.
CREATE TABLE IF NOT EXISTS role_permissions (
  tenant_id  UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('teacher', 'accountant', 'staff', 'parent', 'user')),
  module     VARCHAR(30) NOT NULL,
  level      VARCHAR(5) NOT NULL CHECK (level IN ('none', 'read', 'write')),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role, module)
);
