# Comprehensive Search Plan for YouTube Digest

## Current State

### What's Being Searched
- **Title** (video title) - via `ILIKE`
- **Channel Name** - via `ILIKE`

### What's NOT Being Searched (but should be)
- Summary ("At a Glance")
- Section titles and key points
- Tangent titles and summaries
- Link titles and descriptions
- **Transcript** (not stored - fetched dynamically and discarded)

### Current Implementation
```sql
WHERE user_id = ${userId}
  AND (title ILIKE ${searchPattern} OR channel_name ILIKE ${searchPattern})
```
This is a simple substring match with no indexing support for the wildcards.

---

## Recommended Approach: PostgreSQL Full-Text Search (FTS)

### Why PostgreSQL FTS?
1. **No additional infrastructure** - works with your existing Vercel Postgres
2. **Weighted search** - title matches rank higher than summary matches
3. **Language-aware** - handles stemming ("running" matches "run")
4. **Fast** - GIN indexes provide sub-second searches on large datasets
5. **Proven** - companies like GitLab started with PG FTS before moving to Elasticsearch at massive scale

### Alternative Considered: External Search (Algolia, Meilisearch, Typesense)
- **Pros**: More features, typo tolerance, faceted search
- **Cons**: Additional cost ($$$), data sync complexity, added latency
- **Verdict**: Overkill for this use case. PG FTS handles 100k+ digests easily.

---

## Implementation Plan

### Phase 1: Add Searchable Content Column

Create a computed `tsvector` column that combines all searchable text with weights:

```sql
-- Add the search vector column
ALTER TABLE digests ADD COLUMN search_vector tsvector;

-- Create GIN index for fast searching
CREATE INDEX idx_digests_search ON digests USING gin(search_vector);
```

### Phase 2: Populate Search Vector with Weighted Fields

**Weight hierarchy (A = highest, D = lowest):**
- **A**: Title, Channel Name (most important)
- **B**: Summary, Section Titles
- **C**: Key Points, Tangent Titles/Summaries
- **D**: Link Titles/Descriptions

```sql
-- Trigger function to auto-update search_vector
CREATE OR REPLACE FUNCTION digests_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.channel_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.search_text, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER digests_search_vector_trigger
  BEFORE INSERT OR UPDATE ON digests
  FOR EACH ROW EXECUTE FUNCTION digests_search_vector_update();

-- Backfill existing records
UPDATE digests SET updated_at = updated_at; -- Triggers the function
```

### Phase 3: Update Search Query in Application

```typescript
// In src/lib/db.ts - updated getDigests function
function buildTsQuery(search: string): string {
  return search
    .trim()
    .toLowerCase()
    .replace(/[&|!():*<>'"\\]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `${term}:*`) // Prefix matching
    .join(" & ");
}

// Query with ranking
const result = await sql`
  SELECT *, ts_rank(search_vector, to_tsquery('english', ${tsQuery})) AS rank
  FROM digests
  WHERE user_id = ${userId}
    AND search_vector @@ to_tsquery('english', ${tsQuery})
  ORDER BY rank DESC, created_at DESC
  LIMIT 50
`;
```

---

## Decision: Should We Store Transcripts?

### Option A: Don't Store Transcripts (Recommended)
- **Pros**: Smaller database, faster backups, lower costs
- **Cons**: Can't search within original transcript text
- **Storage impact**: None
- **Search coverage**: Summary + sections + key points (AI-distilled content)

### Option B: Store Full Transcripts
- **Pros**: Can search exact phrases from video
- **Cons**: ~50-200KB per digest, significant storage growth
- **Storage impact**: For 1000 digests → ~50-200MB additional
- **Vercel Postgres limits**: Hobby = 256MB, Pro = 512MB

### Option C: Store Condensed Transcript (Hybrid)
- Store first 5000 characters or key excerpts
- Provides some searchability without full storage cost

**Recommendation**: Start with **Option A** (no transcript storage). The AI-generated summary, sections, and key points already capture the searchable essence of the content. If users frequently can't find content they expect, revisit Option C.

---

## Optional Enhancement: Fuzzy Search with pg_trgm

For typo tolerance (e.g., "javascrpt" → "javascript"):

```sql
-- Enable extension (one-time)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index on title for fuzzy matching
CREATE INDEX idx_digests_title_trgm ON digests USING gin(title gin_trgm_ops);

-- Fuzzy search query
SELECT * FROM digests
WHERE title % 'javascrpt'  -- similarity match
   OR search_vector @@ to_tsquery('english', 'javascript:*')
ORDER BY similarity(title, 'javascrpt') DESC;
```

**Recommendation**: Add this in a future iteration if users report issues finding content due to typos.

---

## Migration Steps

1. **Create migration file** for schema changes
2. **Add search_text column** (populated by the application)
3. **Add search_vector column** (auto-generated via trigger)
4. **Create GIN index**
5. **Create trigger function** for auto-updates
6. **Backfill existing records**
7. **Update application query** in `src/lib/db.ts`
8. **Test thoroughly** with various search terms

---

## Expected Performance

| Dataset Size | Current (ILIKE) | With FTS + GIN |
|--------------|-----------------|----------------|
| 100 digests  | ~10ms           | ~2ms           |
| 1,000 digests| ~50ms           | ~5ms           |
| 10,000 digests| ~500ms+        | ~10ms          |

The GIN index makes FTS queries nearly constant time regardless of table size.

---

## Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| Fields searched | 2 (title, channel) | 8+ (all text content) |
| Search type | Substring (ILIKE) | Full-text with ranking |
| Index support | None for wildcards | GIN index |
| Relevance ranking | None | Weighted by field importance |
| Stemming | No | Yes (run→running) |
| Transcript | Not stored | Not stored (recommend keeping this way) |

---

## Implementation Status: ✅ COMPLETE

The following files were created/modified:

- `migrations/004_add_full_text_search.sql` - Database migration
- `src/lib/db.ts` - Updated with full-text search
- `scripts/backfill-search.ts` - Backfill script for existing records
- `package.json` - Added `backfill-search` script

### Deployment Commands

```bash
# 1. Run migration (local)
pnpm migrate 004_add_full_text_search.sql

# 2. Backfill existing records (local)
pnpm backfill-search

# 3. Run migration (production)
pnpm migrate 004_add_full_text_search.sql --prod

# 4. Backfill existing records (production)
pnpm backfill-search --prod
```

---

## Addendum: Tags (Issue #29)

Tags are **not** included in full-text search. They serve as a separate filtering/faceting mechanism rather than searchable content. Filtering by tag can be combined with full-text search queries.

See [tags-performance.md](./tags-performance.md) for schema design and query patterns.
