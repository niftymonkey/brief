-- Add sharing columns to digests table
ALTER TABLE digests ADD COLUMN is_shared BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE digests ADD COLUMN slug VARCHAR(255);

-- Unique index on slug (only for non-null slugs)
CREATE UNIQUE INDEX idx_digests_slug ON digests(slug) WHERE slug IS NOT NULL;

-- Partial index for efficient lookup of shared digests
CREATE INDEX idx_digests_shared ON digests(id) WHERE is_shared = TRUE;
