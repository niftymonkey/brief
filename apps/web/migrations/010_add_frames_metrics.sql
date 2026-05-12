-- Persist the per-run video-frames pipeline metrics alongside frames_status (#87, Phase 5).
--
-- frames_metrics holds the FramesMetrics blob the CLI ships in
-- submission.frames.included.metrics: candidate counts, classifier/vision
-- tallies, token spend, per-phase wall-clock, and the costSource discriminator.
-- JSONB so the shape can grow (verbatim/summary refinements, future
-- server-issued cost source) without another migration.
--
-- Nullable. Legacy rows (and rows where frames_status='not-requested' or
-- 'attempted-failed' with no metrics) stay NULL. Distinct from the existing
-- `metrics` column, which holds brief-generation metrics (digest LLM tokens +
-- latency).

ALTER TABLE digests ADD COLUMN IF NOT EXISTS frames_metrics JSONB;
