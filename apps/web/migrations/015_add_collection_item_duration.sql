-- Collections: the runtime of the video each item points at.
--
-- The collection page presents a collection as one continuous programme: a total
-- runtime, a cumulative "starts at" for every entry, and a track whose segments
-- are proportional to how long each entry plays. All three need the source
-- video's length, and a collection may point at videos its owner never briefed,
-- so the length cannot be read from `digests`.
--
-- Seconds, as an INTEGER, rather than the ISO 8601 TEXT that `digests.duration`
-- holds. That column is a verbatim snapshot of the YouTube payload kept for
-- display, whereas this one is arithmetic. It sits beside start_sec and end_sec
-- in the same row, measures the same timeline as they do, and gets summed and
-- divided by directly. A second unit and encoding in the same row would force a
-- parse on every read of a clip's true extent.
--
-- Nullable, because a runtime is genuinely unknowable for a live or upcoming
-- broadcast, and any lookup can fail without invalidating the item. The check
-- treats zero as absent for the same reason: YouTube reports a zero length for
-- videos that have no fixed one, and a zero runtime is unusable to anything
-- that divides by it.

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS duration_sec INTEGER;

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_duration_sec_check
  CHECK (duration_sec IS NULL OR duration_sec > 0);
