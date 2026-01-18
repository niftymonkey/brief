-- Create digests table for storing YouTube video digests

CREATE TABLE IF NOT EXISTS digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id VARCHAR(20) NOT NULL,
  title TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_slug TEXT NOT NULL,
  duration TEXT,
  published_at TIMESTAMP,
  thumbnail_url TEXT,
  summary TEXT NOT NULL,
  sections JSONB NOT NULL,
  tangents JSONB,
  related_links JSONB NOT NULL,
  other_links JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for looking up digests by video ID
CREATE INDEX IF NOT EXISTS idx_digests_video_id ON digests(video_id);

-- Index for listing digests by creation date
CREATE INDEX IF NOT EXISTS idx_digests_created_at ON digests(created_at DESC);

-- Index for filtering by channel
CREATE INDEX IF NOT EXISTS idx_digests_channel ON digests(channel_slug);
