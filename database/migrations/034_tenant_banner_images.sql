-- 034 — Bannière multi-images par établissement (additif).
-- tenant_banners reste en place (affiche unique historique) ; son image est reprise ici comme image principale.
CREATE TABLE IF NOT EXISTS tenant_banner_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  image BYTEA NOT NULL,
  mime VARCHAR(20) NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  focal_x NUMERIC(5,2) NOT NULL DEFAULT 50,
  focal_y NUMERIC(5,2) NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tbi_mime_check CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT tbi_size_check CHECK (octet_length(image) <= 2097152),
  CONSTRAINT tbi_focal_check CHECK (focal_x BETWEEN 0 AND 100 AND focal_y BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_tbi_tenant ON tenant_banner_images (tenant_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbi_primary ON tenant_banner_images (tenant_id) WHERE is_primary;

INSERT INTO tenant_banner_images (tenant_id, image, mime, width, height, position, is_primary)
SELECT b.tenant_id, b.image, b.mime, b.width, b.height, 0, true
  FROM tenant_banners b
 WHERE b.image IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant_banner_images t WHERE t.tenant_id = b.tenant_id);
