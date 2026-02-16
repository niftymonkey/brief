-- Drop the tangents column from digests table
-- Tangents are now stored as isTangent flags on individual KeyPoints within sections

ALTER TABLE digests DROP COLUMN IF EXISTS tangents;
