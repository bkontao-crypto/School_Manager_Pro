-- 029 : rôle « gerant » (réouverture de période, PH1-09). Additive : élargit les deux listes de rôles autorisés.
-- Retour arrière : reclasser les comptes « gerant » (vers « admin » ou « teacher ») puis remettre les listes d'origine.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role::text = ANY (ARRAY['superadmin', 'admin', 'gerant', 'teacher', 'accountant', 'staff', 'parent', 'user']::text[]));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check
  CHECK (role::text = ANY (ARRAY['gerant', 'teacher', 'accountant', 'staff', 'parent', 'user']::text[]));
