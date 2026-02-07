import { sql } from "@vercel/postgres";
import type {
  DbDigest,
  DigestSummary,
  VideoMetadata,
  StructuredDigest,
  Link,
  Tag,
} from "./types";

/**
 * Creates a URL-safe slug from a string
 */
function createSlug(text: string, maxLength: number = 60): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, maxLength)
    .replace(/-+$/, "");
}

/**
 * Get thumbnail URL for a video
 */
function getThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Build searchable text from digest content for full-text search
 * Extracts text from summary, sections, and links
 */
function buildSearchText(digest: StructuredDigest): string {
  const parts: string[] = [];

  // Add summary
  if (digest.summary) {
    parts.push(digest.summary);
  }

  // Add section titles and key points
  for (const section of digest.sections) {
    if (section.title) {
      parts.push(section.title);
    }
    for (const kp of section.keyPoints) {
      if (typeof kp === "string") {
        parts.push(kp);
      } else {
        parts.push(kp.text);
      }
    }
  }

  // Add link titles and descriptions
  const allLinks = [...digest.relatedLinks, ...digest.otherLinks];
  for (const link of allLinks) {
    if (link.title) {
      parts.push(link.title);
    }
    if (link.description) {
      parts.push(link.description);
    }
  }

  return parts.join(" ");
}

/**
 * Save a new digest to the database
 */
export async function saveDigest(
  userId: string,
  metadata: VideoMetadata,
  digest: StructuredDigest,
  hasCreatorChapters: boolean
): Promise<DbDigest> {
  const startTime = Date.now();
  console.log(`[DB] saveDigest called, userId: ${userId}, videoId: ${metadata.videoId}`);

  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);
  const searchText = buildSearchText(digest);

  try {
    const result = await sql<DbDigest>`
    INSERT INTO digests (
      user_id,
      video_id,
      title,
      channel_name,
      channel_slug,
      duration,
      published_at,
      thumbnail_url,
      summary,
      sections,
      related_links,
      other_links,
      has_creator_chapters,
      search_text
    ) VALUES (
      ${userId},
      ${metadata.videoId},
      ${metadata.title},
      ${metadata.channelTitle},
      ${channelSlug},
      ${metadata.duration},
      ${metadata.publishedAt},
      ${thumbnailUrl},
      ${digest.summary},
      ${JSON.stringify(digest.sections)},
      ${JSON.stringify(digest.relatedLinks)},
      ${JSON.stringify(digest.otherLinks)},
      ${hasCreatorChapters},
      ${searchText}
    )
    RETURNING
      id,
      user_id as "userId",
      video_id as "videoId",
      title,
      channel_name as "channelName",
      channel_slug as "channelSlug",
      duration,
      published_at as "publishedAt",
      thumbnail_url as "thumbnailUrl",
      summary,
      sections,
      related_links as "relatedLinks",
      other_links as "otherLinks",
      is_shared as "isShared",
      slug,
      has_creator_chapters as "hasCreatorChapters",
      created_at as "createdAt",
      updated_at as "updatedAt"
    `;

    console.log(`[DB] saveDigest success in ${Date.now() - startTime}ms`);
    return result.rows[0];
  } catch (error) {
    console.error(`[DB] saveDigest failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Update an existing digest (for refreshing stale digests)
 */
export async function updateDigest(
  userId: string,
  digestId: string,
  metadata: VideoMetadata,
  digest: StructuredDigest,
  hasCreatorChapters: boolean
): Promise<DbDigest> {
  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);
  const searchText = buildSearchText(digest);

  const result = await sql<DbDigest>`
    UPDATE digests SET
      title = ${metadata.title},
      channel_name = ${metadata.channelTitle},
      channel_slug = ${channelSlug},
      duration = ${metadata.duration},
      published_at = ${metadata.publishedAt},
      thumbnail_url = ${thumbnailUrl},
      summary = ${digest.summary},
      sections = ${JSON.stringify(digest.sections)},
      related_links = ${JSON.stringify(digest.relatedLinks)},
      other_links = ${JSON.stringify(digest.otherLinks)},
      has_creator_chapters = ${hasCreatorChapters},
      search_text = ${searchText},
      updated_at = NOW()
    WHERE id = ${digestId} AND user_id = ${userId}
    RETURNING
      id,
      user_id as "userId",
      video_id as "videoId",
      title,
      channel_name as "channelName",
      channel_slug as "channelSlug",
      duration,
      published_at as "publishedAt",
      thumbnail_url as "thumbnailUrl",
      summary,
      sections,
      related_links as "relatedLinks",
      other_links as "otherLinks",
      is_shared as "isShared",
      slug,
      has_creator_chapters as "hasCreatorChapters",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;

  return result.rows[0];
}

/**
 * Get a digest by ID (optionally verify ownership)
 */
export async function getDigestById(
  id: string,
  userId?: string
): Promise<DbDigest | null> {
  let digest: DbDigest | null = null;

  if (userId) {
    const result = await sql<DbDigest>`
      SELECT
        id,
        user_id as "userId",
        video_id as "videoId",
        title,
        channel_name as "channelName",
        channel_slug as "channelSlug",
        duration,
        published_at as "publishedAt",
        thumbnail_url as "thumbnailUrl",
        summary,
        sections,
        related_links as "relatedLinks",
        other_links as "otherLinks",
        is_shared as "isShared",
        slug,
        has_creator_chapters as "hasCreatorChapters",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE id = ${id} AND user_id = ${userId}
    `;
    digest = result.rows[0] || null;
  } else {
    const result = await sql<DbDigest>`
      SELECT
        id,
        user_id as "userId",
        video_id as "videoId",
        title,
        channel_name as "channelName",
        channel_slug as "channelSlug",
        duration,
        published_at as "publishedAt",
        thumbnail_url as "thumbnailUrl",
        summary,
        sections,
        related_links as "relatedLinks",
        other_links as "otherLinks",
        is_shared as "isShared",
        slug,
        has_creator_chapters as "hasCreatorChapters",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE id = ${id}
    `;
    digest = result.rows[0] || null;
  }

  // Fetch tags for the digest
  if (digest) {
    digest.tags = await getDigestTags(id);
  }

  return digest;
}

/**
 * Get a digest by video ID for a specific user
 */
export async function getDigestByVideoId(
  userId: string,
  videoId: string
): Promise<DbDigest | null> {
  const startTime = Date.now();
  console.log(`[DB] getDigestByVideoId called, userId: ${userId}, videoId: ${videoId}`);

  try {
    const result = await sql<DbDigest>`
      SELECT
        id,
        user_id as "userId",
        video_id as "videoId",
        title,
        channel_name as "channelName",
        channel_slug as "channelSlug",
        duration,
        published_at as "publishedAt",
        thumbnail_url as "thumbnailUrl",
        summary,
        sections,
        related_links as "relatedLinks",
        other_links as "otherLinks",
        is_shared as "isShared",
        slug,
        has_creator_chapters as "hasCreatorChapters",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE user_id = ${userId} AND video_id = ${videoId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log(`[DB] getDigestByVideoId success in ${Date.now() - startTime}ms, found: ${!!result.rows[0]}`);
    return result.rows[0] || null;
  } catch (error) {
    console.error(`[DB] getDigestByVideoId failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Find any existing digest for a video (global cache lookup)
 * Returns the most recent digest regardless of user
 */
export async function findGlobalDigestByVideoId(
  videoId: string
): Promise<DbDigest | null> {
  const startTime = Date.now();
  console.log(`[DB] findGlobalDigestByVideoId called, videoId: ${videoId}`);

  try {
    const result = await sql<DbDigest>`
      SELECT
        id,
        user_id as "userId",
        video_id as "videoId",
        title,
        channel_name as "channelName",
        channel_slug as "channelSlug",
        duration,
        published_at as "publishedAt",
        thumbnail_url as "thumbnailUrl",
        summary,
        sections,
        related_links as "relatedLinks",
        other_links as "otherLinks",
        is_shared as "isShared",
        slug,
        has_creator_chapters as "hasCreatorChapters",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE video_id = ${videoId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log(`[DB] findGlobalDigestByVideoId success in ${Date.now() - startTime}ms, found: ${!!result.rows[0]}`);
    return result.rows[0] || null;
  } catch (error) {
    console.error(`[DB] findGlobalDigestByVideoId failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Copy an existing digest to a new user
 */
export async function copyDigestForUser(
  sourceDigest: DbDigest,
  userId: string
): Promise<DbDigest> {
  const startTime = Date.now();
  console.log(`[DB] copyDigestForUser called, userId: ${userId}, sourceDigestId: ${sourceDigest.id}`);

  // Build search_text from the source digest
  const searchText = buildSearchText({
    summary: sourceDigest.summary,
    sections: sourceDigest.sections,
    relatedLinks: sourceDigest.relatedLinks,
    otherLinks: sourceDigest.otherLinks,
  });

  try {
    const result = await sql<DbDigest>`
    INSERT INTO digests (
      user_id,
      video_id,
      title,
      channel_name,
      channel_slug,
      duration,
      published_at,
      thumbnail_url,
      summary,
      sections,
      related_links,
      other_links,
      has_creator_chapters,
      search_text
    ) VALUES (
      ${userId},
      ${sourceDigest.videoId},
      ${sourceDigest.title},
      ${sourceDigest.channelName},
      ${sourceDigest.channelSlug},
      ${sourceDigest.duration},
      ${sourceDigest.publishedAt?.toISOString() ?? null},
      ${sourceDigest.thumbnailUrl},
      ${sourceDigest.summary},
      ${JSON.stringify(sourceDigest.sections)},
      ${JSON.stringify(sourceDigest.relatedLinks)},
      ${JSON.stringify(sourceDigest.otherLinks)},
      ${sourceDigest.hasCreatorChapters},
      ${searchText}
    )
    RETURNING
      id,
      user_id as "userId",
      video_id as "videoId",
      title,
      channel_name as "channelName",
      channel_slug as "channelSlug",
      duration,
      published_at as "publishedAt",
      thumbnail_url as "thumbnailUrl",
      summary,
      sections,
      related_links as "relatedLinks",
      other_links as "otherLinks",
      is_shared as "isShared",
      slug,
      has_creator_chapters as "hasCreatorChapters",
      created_at as "createdAt",
      updated_at as "updatedAt"
    `;

    console.log(`[DB] copyDigestForUser success in ${Date.now() - startTime}ms`);
    return result.rows[0];
  } catch (error) {
    console.error(`[DB] copyDigestForUser failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Convert search input to tsquery format
 * Handles multiple words with prefix matching
 * Sanitizes input to prevent tsquery syntax errors
 */
function buildTsQuery(search: string): string {
  return search
    .trim()
    .toLowerCase()
    // Remove special tsquery characters that could cause syntax errors
    .replace(/[&|!():*<>'"\\]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `${term}:*`) // Prefix matching for each term
    .join(" & "); // AND between terms
}

interface GetDigestsOptions {
  userId: string;
  limit?: number;
  offset?: number;
  search?: string;
  tags?: string[];      // Tag names to filter by (AND logic)
  dateFrom?: Date;      // Filter createdAt >= dateFrom
  dateTo?: Date;        // Filter createdAt <= dateTo
}

/**
 * Get recent digests for a specific user with optional search and filters
 * Uses PostgreSQL full-text search with ranking when search is provided
 * Tag filtering uses AND logic - all selected tags must match
 */
export async function getDigests(options: GetDigestsOptions): Promise<{ digests: DigestSummary[]; total: number; hasMore: boolean }> {
  const { userId, limit = 20, offset = 0, search, tags, dateFrom, dateTo } = options;

  // Build dynamic WHERE clauses
  const conditions: string[] = ["d.user_id = $1"];
  const params: (string | number | Date)[] = [userId];
  let paramIndex = 2;

  // Full-text search condition
  let tsQuery: string | null = null;
  if (search) {
    tsQuery = buildTsQuery(search);
    conditions.push(`d.search_vector @@ to_tsquery('english', $${paramIndex})`);
    params.push(tsQuery);
    paramIndex++;
  }

  // Tag filtering with AND logic (all tags must match)
  if (tags && tags.length > 0) {
    const tagPlaceholders = tags.map((_, i) => `$${paramIndex + i}`).join(", ");
    conditions.push(`
      d.id IN (
        SELECT dt.digest_id
        FROM digest_tags dt
        JOIN tags t ON dt.tag_id = t.id
        WHERE t.user_id = $1 AND t.name IN (${tagPlaceholders})
        GROUP BY dt.digest_id
        HAVING COUNT(DISTINCT t.name) = $${paramIndex + tags.length}
      )
    `);
    params.push(...tags, tags.length);
    paramIndex += tags.length + 1;
  }

  // Date range filtering
  if (dateFrom) {
    conditions.push(`d.created_at >= $${paramIndex}`);
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    // Add one day to include the full end date
    const endOfDay = new Date(dateTo);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(`d.created_at <= $${paramIndex}`);
    params.push(endOfDay);
    paramIndex++;
  }

  const whereClause = conditions.join(" AND ");

  // Count query
  const countQuery = `
    SELECT COUNT(*) as count
    FROM digests d
    WHERE ${whereClause}
  `;
  const countResult = await sql.query<{ count: string }>(countQuery, params);
  const total = parseInt(countResult.rows[0].count, 10);

  // Data query with ordering
  const orderClause = search
    ? `ORDER BY ts_rank(d.search_vector, to_tsquery('english', $2)) DESC, d.created_at DESC`
    : `ORDER BY d.created_at DESC`;

  const dataQuery = `
    SELECT
      d.id,
      d.video_id as "videoId",
      d.title,
      d.channel_name as "channelName",
      d.thumbnail_url as "thumbnailUrl",
      d.created_at as "createdAt"
    FROM digests d
    WHERE ${whereClause}
    ${orderClause}
    LIMIT $${paramIndex}
    OFFSET $${paramIndex + 1}
  `;
  params.push(limit, offset);

  const result = await sql.query<DigestSummary>(dataQuery, params);
  const digests = result.rows;

  // Batch fetch tags for all digests
  if (digests.length > 0) {
    const digestIds = digests.map((d) => d.id);
    const tagsMap = await getTagsForDigests(digestIds);
    for (const digest of digests) {
      digest.tags = tagsMap.get(digest.id) || [];
    }
  }

  return { digests, total, hasMore: offset + digests.length < total };
}

/**
 * Check if a user has any digests
 */
export async function hasDigests(userId: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS(SELECT 1 FROM digests WHERE user_id = ${userId} LIMIT 1) as exists
  `;
  return result.rows[0]?.exists ?? false;
}

/**
 * Delete a digest by ID (with user ownership verification)
 */
export async function deleteDigest(userId: string, id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM digests WHERE id = ${id} AND user_id = ${userId}
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get a shared digest by its slug (public access, no auth required)
 */
export async function getSharedDigestBySlug(
  slug: string
): Promise<DbDigest | null> {
  const result = await sql<DbDigest>`
    SELECT
      id,
      user_id as "userId",
      video_id as "videoId",
      title,
      channel_name as "channelName",
      channel_slug as "channelSlug",
      duration,
      published_at as "publishedAt",
      thumbnail_url as "thumbnailUrl",
      summary,
      sections,
      related_links as "relatedLinks",
      other_links as "otherLinks",
      is_shared as "isShared",
      slug,
      has_creator_chapters as "hasCreatorChapters",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM digests
    WHERE slug = ${slug} AND is_shared = TRUE
  `;

  return result.rows[0] || null;
}

/**
 * Toggle sharing state for a digest
 * When enabling, generates a unique slug from the title
 * When disabling, keeps the slug (in case user re-enables later)
 */
export async function toggleDigestSharing(
  userId: string,
  digestId: string,
  isShared: boolean,
  title?: string
): Promise<{ isShared: boolean; slug: string | null } | null> {
  // If enabling sharing, we may need to generate a slug
  // Use a single query with COALESCE to only generate slug if it doesn't exist
  if (isShared && title) {
    const baseSlug = createSlug(title);
    // Try to update with the base slug, falling back to existing slug if already set
    // The unique constraint will catch collisions
    const result = await sql<{ is_shared: boolean; slug: string | null }>`
      UPDATE digests
      SET
        is_shared = ${isShared},
        slug = COALESCE(slug, ${baseSlug}),
        updated_at = NOW()
      WHERE id = ${digestId} AND user_id = ${userId}
      RETURNING is_shared, slug
    `;

    if (result.rows.length === 0) {
      return null;
    }

    return {
      isShared: result.rows[0].is_shared,
      slug: result.rows[0].slug,
    };
  }

  // Simple toggle (disabling, or re-enabling with existing slug)
  const result = await sql<{ is_shared: boolean; slug: string | null }>`
    UPDATE digests
    SET is_shared = ${isShared}, updated_at = NOW()
    WHERE id = ${digestId} AND user_id = ${userId}
    RETURNING is_shared, slug
  `;

  if (result.rows.length === 0) {
    return null;
  }

  return {
    isShared: result.rows[0].is_shared,
    slug: result.rows[0].slug,
  };
}

// ============================================
// Tag Functions
// ============================================

/**
 * Get all tags for a user (their vocabulary) with usage counts
 * Sorted by usage count descending so most-used tags appear first
 */
export async function getUserTags(userId: string): Promise<Tag[]> {
  const result = await sql<Tag & { usagecount: number }>`
    SELECT t.id, t.name, COUNT(dt.digest_id)::int as usagecount
    FROM tags t
    LEFT JOIN digest_tags dt ON t.id = dt.tag_id
    WHERE t.user_id = ${userId}
    GROUP BY t.id, t.name
    ORDER BY t.name ASC
  `;
  // Map the lowercase column name to camelCase
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    usageCount: row.usagecount,
  }));
}

/**
 * Get tags for a specific digest
 */
export async function getDigestTags(digestId: string): Promise<Tag[]> {
  const result = await sql<Tag>`
    SELECT t.id, t.name
    FROM tags t
    JOIN digest_tags dt ON t.id = dt.tag_id
    WHERE dt.digest_id = ${digestId}
    ORDER BY t.name ASC
  `;
  return result.rows;
}

/**
 * Get tags for multiple digests in a single query (batch)
 */
export async function getTagsForDigests(
  digestIds: string[]
): Promise<Map<string, Tag[]>> {
  if (digestIds.length === 0) {
    return new Map();
  }

  // Build parameterized query for IN clause
  const placeholders = digestIds.map((_, i) => `$${i + 1}`).join(", ");
  const query = `
    SELECT dt.digest_id as "digestId", t.id, t.name
    FROM tags t
    JOIN digest_tags dt ON t.id = dt.tag_id
    WHERE dt.digest_id IN (${placeholders})
    ORDER BY t.name ASC
  `;

  const result = await sql.query<{ digestId: string; id: string; name: string }>(
    query,
    digestIds
  );

  const tagsMap = new Map<string, Tag[]>();
  for (const row of result.rows) {
    const tags = tagsMap.get(row.digestId) || [];
    tags.push({ id: row.id, name: row.name });
    tagsMap.set(row.digestId, tags);
  }

  return tagsMap;
}

/**
 * Add a tag to a digest
 * Creates the tag if it doesn't exist in user's vocabulary
 * Tag names are normalized to lowercase
 */
export async function addTagToDigest(
  userId: string,
  digestId: string,
  tagName: string
): Promise<Tag> {
  const normalizedName = tagName.toLowerCase().trim();

  if (!normalizedName) {
    throw new Error("Tag name cannot be empty");
  }

  if (normalizedName.length > 50) {
    throw new Error("Tag name cannot exceed 50 characters");
  }

  // First, verify the digest belongs to the user
  const digestCheck = await sql`
    SELECT id FROM digests WHERE id = ${digestId} AND user_id = ${userId}
  `;
  if (digestCheck.rows.length === 0) {
    throw new Error("Digest not found");
  }

  // Check current tag count for this digest
  const countResult = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM digest_tags WHERE digest_id = ${digestId}
  `;
  if (parseInt(countResult.rows[0].count, 10) >= 20) {
    throw new Error("Maximum of 20 tags per digest");
  }

  // Insert or get the tag
  const tagResult = await sql<Tag>`
    INSERT INTO tags (user_id, name)
    VALUES (${userId}, ${normalizedName})
    ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;
  const tag = tagResult.rows[0];

  // Link tag to digest (ignore if already linked)
  await sql`
    INSERT INTO digest_tags (digest_id, tag_id)
    VALUES (${digestId}, ${tag.id})
    ON CONFLICT (digest_id, tag_id) DO NOTHING
  `;

  return tag;
}

/**
 * Remove a tag from a digest
 * Only removes the association, not the tag itself
 */
export async function removeTagFromDigest(
  userId: string,
  digestId: string,
  tagId: string
): Promise<boolean> {
  // Verify ownership through the digests table
  const result = await sql`
    DELETE FROM digest_tags
    WHERE digest_id = ${digestId}
      AND tag_id = ${tagId}
      AND EXISTS (
        SELECT 1 FROM digests WHERE id = ${digestId} AND user_id = ${userId}
      )
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a tag entirely from a user's vocabulary
 * Also removes all associations with digests
 */
export async function deleteTag(tagId: string, userId: string): Promise<boolean> {
  // First delete all digest_tags associations for this tag
  await sql`
    DELETE FROM digest_tags
    WHERE tag_id = ${tagId}
      AND EXISTS (
        SELECT 1 FROM tags WHERE id = ${tagId} AND user_id = ${userId}
      )
  `;

  // Then delete the tag itself
  const result = await sql`
    DELETE FROM tags
    WHERE id = ${tagId}
      AND user_id = ${userId}
  `;

  return (result.rowCount ?? 0) > 0;
}
