-- Add flag to track whether chapters came from creator or were AI-generated
-- NULL for old digests (unknown), true/false for new ones

ALTER TABLE digests ADD COLUMN IF NOT EXISTS has_creator_chapters BOOLEAN;
