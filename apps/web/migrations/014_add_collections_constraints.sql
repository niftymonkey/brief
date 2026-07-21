-- Collections: data integrity constraints for summary_status, clip bounds, and shared slugs.

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_summary_status_check
  CHECK (summary_status IN ('pending', 'ready', 'failed'));

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_start_sec_check
  CHECK (start_sec IS NULL OR start_sec >= 0);

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_end_sec_check
  CHECK (end_sec IS NULL OR end_sec >= 0);

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_end_after_start_check
  CHECK (start_sec IS NULL OR end_sec IS NULL OR end_sec >= start_sec);

ALTER TABLE collections
  ADD CONSTRAINT collections_shared_requires_slug_check
  CHECK (NOT is_shared OR slug IS NOT NULL);
