-- Add status tracking for async brief creation (extension support)
-- Default 'completed' so all existing rows are unaffected

ALTER TABLE digests ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed';
ALTER TABLE digests ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Partial index: only index non-completed briefs (the ones we poll for)
CREATE INDEX IF NOT EXISTS idx_digests_status ON digests(status) WHERE status != 'completed';
