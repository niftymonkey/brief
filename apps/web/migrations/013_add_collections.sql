-- Collections: user-owned, ordered sets of clip pointers, shareable by slug.

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  slug VARCHAR(255),
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_collections_slug ON collections(slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_collections_user_id ON collections(user_id);
CREATE INDEX idx_collections_shared ON collections(id) WHERE is_shared = TRUE;

CREATE TABLE IF NOT EXISTS collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  video_id VARCHAR(20) NOT NULL,
  start_sec INTEGER,
  end_sec INTEGER,
  video_title TEXT,
  summary TEXT,
  summary_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  position DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_collection_items_collection ON collection_items(collection_id, position);
