-- Add full-text search capability to digests table
-- This migration adds a search_text column (populated by the application)
-- and a search_vector column (auto-generated via trigger) with a GIN index

-- Step 1: Add the search_text column to store all searchable content
-- This is populated by the application when saving/updating digests
ALTER TABLE digests ADD COLUMN IF NOT EXISTS search_text TEXT;

-- Step 2: Add the tsvector column for full-text search
ALTER TABLE digests ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Step 3: Create a function to update search_vector from search_text
CREATE OR REPLACE FUNCTION digests_search_vector_update()
RETURNS trigger AS $$
BEGIN
  -- Build weighted search vector:
  -- Weight A: title, channel_name (most important)
  -- Weight B-D: content from search_text (summary, sections, etc.)
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.channel_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.search_text, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to auto-update search_vector
DROP TRIGGER IF EXISTS digests_search_vector_trigger ON digests;
CREATE TRIGGER digests_search_vector_trigger
  BEFORE INSERT OR UPDATE ON digests
  FOR EACH ROW EXECUTE FUNCTION digests_search_vector_update();

-- Step 5: Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_digests_search_vector ON digests USING gin(search_vector);

-- Step 6: Backfill existing records
-- This triggers the search_vector update for all existing rows
-- The search_text will be NULL initially, but title/channel will be indexed
UPDATE digests SET updated_at = updated_at WHERE search_vector IS NULL;
