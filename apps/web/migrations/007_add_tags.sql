-- Add tags functionality to digests
-- Tags are per-user, case-insensitive, stored in normalized form (lowercase)

-- Step 1: Create tags table (user's tag vocabulary)
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Step 2: Create digest_tags junction table
CREATE TABLE IF NOT EXISTS digest_tags (
  digest_id UUID REFERENCES digests(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (digest_id, tag_id)
);

-- Step 3: Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name);
CREATE INDEX IF NOT EXISTS idx_digest_tags_digest_id ON digest_tags(digest_id);
CREATE INDEX IF NOT EXISTS idx_digest_tags_tag_id ON digest_tags(tag_id);
