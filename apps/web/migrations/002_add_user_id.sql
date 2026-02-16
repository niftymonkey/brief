-- Add user_id column to digests table
ALTER TABLE digests ADD COLUMN user_id TEXT;

-- Backfill existing digests with a special marker (keeps them as cache sources, not visible to users)
UPDATE digests SET user_id = '__migrated__' WHERE user_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE digests ALTER COLUMN user_id SET NOT NULL;

-- Create indexes for efficient user-scoped queries
CREATE INDEX IF NOT EXISTS idx_digests_user_id ON digests(user_id);
CREATE INDEX IF NOT EXISTS idx_digests_user_video ON digests(user_id, video_id);
