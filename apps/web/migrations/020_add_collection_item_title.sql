-- Collections: a title of each clip's own, and who wrote each clip's words.
--
-- A clip used to borrow its heading from the video it points at, so two clips
-- cut from one video read as the same entry. `title` is the clip's own name.
-- Nullable, because a clip added before this column, or one whose title has
-- not been written yet, has none, and readers fall back to `video_title` while
-- it is NULL.
--
-- The two flags record whether the author wrote the title or the note by hand.
-- Moving a clip's bounds or pointing it at another video makes a machine-written
-- title or note describe footage the clip no longer shows, so those are cleared
-- and written again. A hand-written one is the author's own words about the
-- clip and is kept. The flag is what tells the two apart, because the text
-- alone cannot.
--
-- NOT NULL DEFAULT false, so every existing row reads as machine-written. No
-- earlier row recorded who wrote its note, and a row that never had a title of
-- its own has no hand-written one to protect.

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS title_authored BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS summary_authored BOOLEAN NOT NULL DEFAULT false;
