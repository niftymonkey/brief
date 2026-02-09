# Tags Performance Decision

## Context

Issue #29 adds a tagging system for briefs. This document explains the schema design choices and their performance implications.

## Why Normalized Schema Over JSONB

We chose a normalized approach (separate `tags` and `digest_tags` tables) over storing tags as a JSONB array on the digests table.

### Advantages of Normalized Schema

1. **Efficient filtering**: When filtering digests by tag (issue #30), we can use indexed joins rather than scanning JSONB arrays
2. **Auto-suggest performance**: Fetching a user's tag vocabulary is a simple indexed query on `tags(user_id)`
3. **Tag management**: Future features like renaming tags or merging duplicates are straightforward UPDATE operations
4. **Referential integrity**: Foreign keys ensure orphaned references can't exist
5. **Storage efficiency**: Tag names stored once, referenced by UUID (vs. duplicated strings in JSONB)

### Trade-offs

- **Write complexity**: Adding a tag requires INSERT into both tables (mitigated by ON CONFLICT handling)
- **Read complexity**: Requires JOIN to fetch tags with digests (mitigated by batch queries)

## Index Strategy

```sql
-- Find all tags for a user (auto-suggest)
CREATE INDEX idx_tags_user_id ON tags(user_id);

-- Look up tag by name for a user (add tag operation)
CREATE INDEX idx_tags_user_name ON tags(user_id, name);

-- Find tags for a brief
CREATE INDEX idx_digest_tags_digest_id ON digest_tags(digest_id);

-- Find briefs with a tag (future filtering)
CREATE INDEX idx_digest_tags_tag_id ON digest_tags(tag_id);
```

## Query Patterns

### Adding a Tag
```sql
-- 1. Upsert tag into vocabulary
INSERT INTO tags (user_id, name) VALUES ($1, $2)
ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
RETURNING id, name;

-- 2. Link to brief
INSERT INTO digest_tags (digest_id, tag_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;
```

### Fetching Briefs with Tags (Batch)
```sql
-- After fetching briefs, batch-load their tags
SELECT dt.digest_id, t.id, t.name
FROM tags t
JOIN digest_tags dt ON t.id = dt.tag_id
WHERE dt.digest_id IN ($1, $2, ...)
ORDER BY t.name;
```

### Future: Filtering by Tag (Issue #30)
```sql
-- Find briefs with specific tag
SELECT d.*
FROM digests d
JOIN digest_tags dt ON d.id = dt.digest_id
JOIN tags t ON dt.tag_id = t.id
WHERE d.user_id = $1 AND t.name = $2
ORDER BY d.created_at DESC;

-- Combine with full-text search
SELECT d.*
FROM digests d
JOIN digest_tags dt ON d.id = dt.digest_id
JOIN tags t ON dt.tag_id = t.id
WHERE d.user_id = $1
  AND t.name = $2
  AND d.search_vector @@ to_tsquery('english', $3)
ORDER BY ts_rank(d.search_vector, to_tsquery('english', $3)) DESC;
```

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Add tag | O(1) | Two indexed inserts |
| Remove tag | O(1) | Single indexed delete |
| Get brief tags | O(n) | n = number of tags on brief |
| Get user vocabulary | O(n) | n = unique tags user has created |
| Batch load tags | O(n) | n = total tags across requested briefs |
| Filter by tag | O(log n) | Indexed join, very fast |

## Limits

- **20 tags per brief**: Soft limit enforced in application layer
- **50 char tag name**: Database constraint prevents abuse
- **Case-insensitive**: Tags normalized to lowercase on insert
