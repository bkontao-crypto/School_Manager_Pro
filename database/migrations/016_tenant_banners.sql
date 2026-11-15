-- 016 : affiche d'accueil personnalisable par établissement (image + textes). Absence de ligne = affiche par défaut.
CREATE TABLE IF NOT EXISTS tenant_banners (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  image       BYTEA,
  mime        VARCHAR(30),
  width       INTEGER,
  height      INTEGER,
  title       VARCHAR(120),
  subtitle    VARCHAR(240),
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_banners_image_check CHECK (
    (image IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL)
    OR (image IS NOT NULL AND mime IN ('image/png','image/jpeg','image/webp') AND width > 0 AND height > 0)),
  CONSTRAINT tenant_banners_size_check CHECK (image IS NULL OR octet_length(image) <= 2097152)
);
