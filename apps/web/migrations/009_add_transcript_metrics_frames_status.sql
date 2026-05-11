-- Brief schema foundations for downstream LLM consumers (#85).
--
-- Three additive columns. Existing rows are unaffected:
--   - transcript      JSONB     nullable, NULL for legacy rows
--   - metrics         JSONB     nullable, NULL for legacy rows
--   - frames_status   enum      NOT NULL, defaults to 'not-requested' (back-fills automatically)
--
-- transcript holds the structured per-entry transcript (matches @brief/core's
-- TranscriptEntry shape: offsetSec/durationSec/text) plus the source. JSONB so
-- the shape can grow (e.g., visual segments from the video-frames feature #87)
-- without another migration.
--
-- metrics holds per-generation telemetry: { inputTokens, outputTokens, model,
-- latencyMs }. JSONB to stay extensible.
--
-- frames_status captures user intent + pipeline outcome: 'included' |
-- 'attempted-failed' | 'not-requested'. Only the default 'not-requested' is
-- written by code shipping in this migration. The frames feature populates the
-- other values when it lands.

ALTER TABLE digests ADD COLUMN IF NOT EXISTS transcript JSONB;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS metrics JSONB;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS frames_status VARCHAR(20) NOT NULL DEFAULT 'not-requested';
