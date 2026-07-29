-- Collections: the frame shape of the video each item points at.
--
-- A collection holds whatever its curator put in it, and YouTube Shorts are
-- 9:16 while ordinary uploads are 16:9 and archive footage is 4:3. Rendering
-- every entry inside one fixed 16:9 frame pillarboxes the vertical ones into a
-- narrow strip with black filling most of the width, so the page needs to know
-- each entry's real shape before it lays the entry out.
--
-- A number, width divided by height, rather than a vertical/not-vertical flag.
-- 4:3 is neither, and a boolean would have to file it under one of the two and
-- keep pillarboxing it. DOUBLE PRECISION rather than REAL so a ratio reads back
-- out as the value that was written instead of a float4 approximation of it,
-- matching `position` in this same table.
--
-- Nullable, because YouTube reports embed dimensions only for videos whose
-- shape it knows, and any lookup can fail without invalidating the item. NULL
-- means the shape is unknown rather than any particular shape, so readers
-- supply their own default and an unfilled row renders exactly as it did before
-- this column existed. The check treats zero and negatives the same way: a
-- non-positive ratio describes no frame that can be drawn.

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS aspect_ratio DOUBLE PRECISION;

ALTER TABLE collection_items
  ADD CONSTRAINT collection_items_aspect_ratio_check
  CHECK (aspect_ratio IS NULL OR aspect_ratio > 0);
