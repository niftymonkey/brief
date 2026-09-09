-- Topics: a standing subject a person follows, with the channels and searches that feed it.

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,

  -- The slug is minted from the name when the Topic is created and then left alone: a
  -- rename changes `name` only. That keeps every `/topics/<slug>` link a person has
  -- saved or shared working without a redirect table to maintain, and a person who
  -- actually wants a different slug edits this column directly.
  --
  -- Uniqueness is per user (see idx_topics_user_slug), not global, because the path
  -- is only ever resolved inside one owner's account. Two people following Rust both
  -- get `rust`, and neither has to discover that the name they chose was taken by a
  -- stranger. This is the opposite of `collections.slug`, which is globally unique
  -- because it addresses a public page at `/c/<slug>`.
  slug VARCHAR(255) NOT NULL,

  interests TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- cadence_days is how often a Run fires. window_days is how far back that Run looks
  -- for videos. The window must be at least the cadence (enforced in 017), otherwise
  -- consecutive Runs leave a gap of days that nothing ever reads, and a video published
  -- in that gap is missed permanently rather than merely late.
  --
  -- Equal values are the degenerate case: they cover the timeline exactly but leave no
  -- overlap, so a video that YouTube indexes slightly late falls between two Runs. The
  -- window default is 7 days, so the cadence defaults to 3 to sit comfortably inside it
  -- and give every video at least two chances to be seen. Both stay editable.
  cadence_days INTEGER NOT NULL DEFAULT 3,
  window_days INTEGER NOT NULL DEFAULT 7,

  max_standing_queries INTEGER NOT NULL DEFAULT 10,
  max_probes_per_run INTEGER NOT NULL DEFAULT 5,
  max_groups_per_run INTEGER NOT NULL DEFAULT 4,
  max_videos_per_group INTEGER NOT NULL DEFAULT 3,
  max_channel_videos_per_run INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_topics_user_id ON topics(user_id);
CREATE UNIQUE INDEX idx_topics_user_slug ON topics(user_id, slug);

CREATE TABLE IF NOT EXISTS topic_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  channel_title TEXT,
  channel_url TEXT,
  added_via VARCHAR(20) NOT NULL DEFAULT 'takeout',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_topic_channels_topic ON topic_channels(topic_id);
CREATE UNIQUE INDEX idx_topic_channels_unique ON topic_channels(topic_id, youtube_channel_id);

CREATE TABLE IF NOT EXISTS topic_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_topic_queries_topic ON topic_queries(topic_id);
CREATE UNIQUE INDEX idx_topic_queries_unique ON topic_queries(topic_id, query);
