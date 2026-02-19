import { sql } from "@vercel/postgres";
import type {
  DbBrief,
  BriefSummary,
  VideoMetadata,
  StructuredBrief,
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
 * Build searchable text from brief content for full-text search
 * Extracts text from summary, sections, and links
 */
function buildSearchText(brief: StructuredBrief): string {
  const parts: string[] = [];

  // Add summary
  if (brief.summary) {
    parts.push(brief.summary);
  }

  // Add section titles and key points
  for (const section of brief.sections) {
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
  const allLinks = [...brief.relatedLinks, ...brief.otherLinks];
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
 * Save a new brief to the database
 */
export async function saveBrief(
  userId: string,
  metadata: VideoMetadata,
  brief: StructuredBrief,
  hasCreatorChapters: boolean
): Promise<DbBrief> {
  const startTime = Date.now();
  console.log(`[DB] saveBrief called, userId: ${userId}, videoId: ${metadata.videoId}`);

  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);
  const searchText = buildSearchText(brief);

  try {
    const result = await sql<DbBrief>`
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
      ${brief.summary},
      ${JSON.stringify(brief.sections)},
      ${JSON.stringify(brief.relatedLinks)},
      ${JSON.stringify(brief.otherLinks)},
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
      status,
      error_message as "errorMessage",
      created_at as "createdAt",
      updated_at as "updatedAt"
    `;

    console.log(`[DB] saveBrief success in ${Date.now() - startTime}ms`);
    return result.rows[0];
  } catch (error) {
    console.error(`[DB] saveBrief failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Update an existing brief (for refreshing stale briefs)
 */
export async function updateBrief(
  userId: string,
  briefId: string,
  metadata: VideoMetadata,
  brief: StructuredBrief,
  hasCreatorChapters: boolean
): Promise<DbBrief> {
  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);
  const searchText = buildSearchText(brief);

  const result = await sql<DbBrief>`
    UPDATE digests SET
      title = ${metadata.title},
      channel_name = ${metadata.channelTitle},
      channel_slug = ${channelSlug},
      duration = ${metadata.duration},
      published_at = ${metadata.publishedAt},
      thumbnail_url = ${thumbnailUrl},
      summary = ${brief.summary},
      sections = ${JSON.stringify(brief.sections)},
      related_links = ${JSON.stringify(brief.relatedLinks)},
      other_links = ${JSON.stringify(brief.otherLinks)},
      has_creator_chapters = ${hasCreatorChapters},
      search_text = ${searchText},
      updated_at = NOW()
    WHERE id = ${briefId} AND user_id = ${userId}
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
      status,
      error_message as "errorMessage",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `;

  return result.rows[0];
}

/**
 * Get a brief by ID (optionally verify ownership)
 */
export async function getBriefById(
  id: string,
  userId?: string
): Promise<DbBrief | null> {
  let brief: DbBrief | null = null;

  if (userId) {
    const result = await sql<DbBrief>`
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
        status,
        error_message as "errorMessage",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE id = ${id} AND user_id = ${userId}
    `;
    brief = result.rows[0] || null;
  } else {
    const result = await sql<DbBrief>`
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
        status,
        error_message as "errorMessage",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE id = ${id}
    `;
    brief = result.rows[0] || null;
  }

  // Fetch tags for the brief
  if (brief) {
    brief.tags = await getBriefTags(id);
  }

  return brief;
}

/**
 * Get a brief by video ID for a specific user
 */
export async function getBriefByVideoId(
  userId: string,
  videoId: string
): Promise<DbBrief | null> {
  const startTime = Date.now();
  console.log(`[DB] getBriefByVideoId called, userId: ${userId}, videoId: ${videoId}`);

  try {
    const result = await sql<DbBrief>`
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
        status,
        error_message as "errorMessage",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE user_id = ${userId} AND video_id = ${videoId} AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log(`[DB] getBriefByVideoId success in ${Date.now() - startTime}ms, found: ${!!result.rows[0]}`);
    return result.rows[0] || null;
  } catch (error) {
    console.error(`[DB] getBriefByVideoId failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Find any existing brief for a video (global cache lookup)
 * Returns the most recent brief regardless of user
 */
export async function findGlobalBriefByVideoId(
  videoId: string
): Promise<DbBrief | null> {
  const startTime = Date.now();
  console.log(`[DB] findGlobalBriefByVideoId called, videoId: ${videoId}`);

  try {
    const result = await sql<DbBrief>`
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
        status,
        error_message as "errorMessage",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE video_id = ${videoId} AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log(`[DB] findGlobalBriefByVideoId success in ${Date.now() - startTime}ms, found: ${!!result.rows[0]}`);
    return result.rows[0] || null;
  } catch (error) {
    console.error(`[DB] findGlobalBriefByVideoId failed in ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

/**
 * Copy an existing brief to a new user
 */
export async function copyBriefForUser(
  sourceBrief: DbBrief,
  userId: string
): Promise<DbBrief> {
  const startTime = Date.now();
  console.log(`[DB] copyBriefForUser called, userId: ${userId}, sourceBriefId: ${sourceBrief.id}`);

  // Build search_text from the source brief
  const searchText = buildSearchText({
    summary: sourceBrief.summary,
    sections: sourceBrief.sections,
    relatedLinks: sourceBrief.relatedLinks,
    otherLinks: sourceBrief.otherLinks,
  });

  try {
    const result = await sql<DbBrief>`
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
      ${sourceBrief.videoId},
      ${sourceBrief.title},
      ${sourceBrief.channelName},
      ${sourceBrief.channelSlug},
      ${sourceBrief.duration},
      ${sourceBrief.publishedAt?.toISOString() ?? null},
      ${sourceBrief.thumbnailUrl},
      ${sourceBrief.summary},
      ${JSON.stringify(sourceBrief.sections)},
      ${JSON.stringify(sourceBrief.relatedLinks)},
      ${JSON.stringify(sourceBrief.otherLinks)},
      ${sourceBrief.hasCreatorChapters},
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
      status,
      error_message as "errorMessage",
      created_at as "createdAt",
      updated_at as "updatedAt"
    `;

    console.log(`[DB] copyBriefForUser success in ${Date.now() - startTime}ms`);
    return result.rows[0];
  } catch (error) {
    console.error(`[DB] copyBriefForUser failed in ${Date.now() - startTime}ms:`, error);
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

interface GetBriefsOptions {
  userId: string;
  limit?: number;
  offset?: number;
  search?: string;
  tags?: string[];      // Tag names to filter by (AND logic)
  dateFrom?: Date;      // Filter createdAt >= dateFrom
  dateTo?: Date;        // Filter createdAt <= dateTo
}

/**
 * Get recent briefs for a specific user with optional search and filters
 * Uses PostgreSQL full-text search with ranking when search is provided
 * Tag filtering uses AND logic - all selected tags must match
 */
export async function getBriefs(options: GetBriefsOptions): Promise<{ briefs: BriefSummary[]; total: number; hasMore: boolean }> {
  const { userId, limit = 20, offset = 0, search, tags, dateFrom, dateTo } = options;

  // Build dynamic WHERE clauses
  // Only show completed briefs in the library (exclude queued/processing/failed)
  const conditions: string[] = ["d.user_id = $1", "d.status = 'completed'"];
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

  const result = await sql.query<BriefSummary>(dataQuery, params);
  const briefs = result.rows;

  // Batch fetch tags for all briefs
  if (briefs.length > 0) {
    const briefIds = briefs.map((d) => d.id);
    const tagsMap = await getTagsForBriefs(briefIds);
    for (const brief of briefs) {
      brief.tags = tagsMap.get(brief.id) || [];
    }
  }

  return { briefs, total, hasMore: offset + briefs.length < total };
}

/**
 * Check if a user has any briefs
 */
export async function hasBriefs(userId: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS(SELECT 1 FROM digests WHERE user_id = ${userId} LIMIT 1) as exists
  `;
  return result.rows[0]?.exists ?? false;
}

/**
 * Delete a brief by ID (with user ownership verification)
 */
export async function deleteBrief(userId: string, id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM digests WHERE id = ${id} AND user_id = ${userId}
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get a shared brief by its slug (public access, no auth required)
 */
export async function getSharedBriefBySlug(
  slug: string
): Promise<DbBrief | null> {
  const result = await sql<DbBrief>`
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
      status,
      error_message as "errorMessage",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM digests
    WHERE slug = ${slug} AND is_shared = TRUE
  `;

  return result.rows[0] || null;
}

/**
 * Toggle sharing state for a brief
 * When enabling, generates a unique slug from the title
 * When disabling, keeps the slug (in case user re-enables later)
 */
export async function toggleBriefSharing(
  userId: string,
  briefId: string,
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
      WHERE id = ${briefId} AND user_id = ${userId}
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
    WHERE id = ${briefId} AND user_id = ${userId}
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
// Async Brief Status Functions
// ============================================

/**
 * Create a pending brief placeholder for async processing
 */
export async function getPendingBriefByVideoId(
  userId: string,
  videoId: string
): Promise<{ id: string; status: string } | null> {
  const result = await sql<{ id: string; status: string }>`
    SELECT id, status
    FROM digests
    WHERE user_id = ${userId} AND video_id = ${videoId} AND status IN ('queued', 'processing')
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return result.rows[0] || null;
}

export async function createPendingBrief(
  userId: string,
  videoId: string
): Promise<string> {
  const thumbnailUrl = getThumbnailUrl(videoId);

  const result = await sql<{ id: string }>`
    INSERT INTO digests (
      user_id,
      video_id,
      title,
      channel_name,
      channel_slug,
      thumbnail_url,
      summary,
      sections,
      related_links,
      other_links,
      status
    ) VALUES (
      ${userId},
      ${videoId},
      'Processing...',
      '',
      '',
      ${thumbnailUrl},
      '',
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      'queued'
    )
    RETURNING id
  `;

  return result.rows[0].id;
}

/**
 * Update the status of a pending brief
 */
export async function updateBriefStatus(
  briefId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  await sql`
    UPDATE digests
    SET status = ${status},
        error_message = ${errorMessage ?? null},
        updated_at = NOW()
    WHERE id = ${briefId}
  `;
}

/**
 * Fill in a pending brief with actual content and mark as completed
 */
export async function completePendingBrief(
  userId: string,
  briefId: string,
  metadata: VideoMetadata,
  brief: StructuredBrief,
  hasCreatorChapters: boolean
): Promise<void> {
  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);
  const searchText = buildSearchText(brief);

  await sql`
    UPDATE digests SET
      title = ${metadata.title},
      channel_name = ${metadata.channelTitle},
      channel_slug = ${channelSlug},
      duration = ${metadata.duration},
      published_at = ${metadata.publishedAt},
      thumbnail_url = ${thumbnailUrl},
      summary = ${brief.summary},
      sections = ${JSON.stringify(brief.sections)},
      related_links = ${JSON.stringify(brief.relatedLinks)},
      other_links = ${JSON.stringify(brief.otherLinks)},
      has_creator_chapters = ${hasCreatorChapters},
      search_text = ${searchText},
      status = 'completed',
      error_message = NULL,
      updated_at = NOW()
    WHERE id = ${briefId} AND user_id = ${userId}
  `;
}

/**
 * Get the status of a brief (for polling)
 */
export async function getBriefStatus(
  briefId: string,
  userId: string
): Promise<{ status: string; briefId: string; error?: string } | null> {
  const result = await sql<{ id: string; status: string; error_message: string | null }>`
    SELECT id, status, error_message
    FROM digests
    WHERE id = ${briefId} AND user_id = ${userId}
  `;

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    status: row.status,
    briefId: row.id,
    ...(row.error_message ? { error: row.error_message } : {}),
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
 * Get tags for a specific brief
 */
export async function getBriefTags(briefId: string): Promise<Tag[]> {
  const result = await sql<Tag>`
    SELECT t.id, t.name
    FROM tags t
    JOIN digest_tags dt ON t.id = dt.tag_id
    WHERE dt.digest_id = ${briefId}
    ORDER BY t.name ASC
  `;
  return result.rows;
}

/**
 * Get tags for multiple briefs in a single query (batch)
 */
export async function getTagsForBriefs(
  briefIds: string[]
): Promise<Map<string, Tag[]>> {
  if (briefIds.length === 0) {
    return new Map();
  }

  // Build parameterized query for IN clause
  const placeholders = briefIds.map((_, i) => `$${i + 1}`).join(", ");
  const query = `
    SELECT dt.digest_id as "briefId", t.id, t.name
    FROM tags t
    JOIN digest_tags dt ON t.id = dt.tag_id
    WHERE dt.digest_id IN (${placeholders})
    ORDER BY t.name ASC
  `;

  const result = await sql.query<{ briefId: string; id: string; name: string }>(
    query,
    briefIds
  );

  const tagsMap = new Map<string, Tag[]>();
  for (const row of result.rows) {
    const tags = tagsMap.get(row.briefId) || [];
    tags.push({ id: row.id, name: row.name });
    tagsMap.set(row.briefId, tags);
  }

  return tagsMap;
}

/**
 * Add a tag to a brief
 * Creates the tag if it doesn't exist in user's vocabulary
 * Tag names are normalized to lowercase
 */
export async function addTagToBrief(
  userId: string,
  briefId: string,
  tagName: string
): Promise<Tag> {
  const normalizedName = tagName.toLowerCase().trim();

  if (!normalizedName) {
    throw new Error("Tag name cannot be empty");
  }

  if (normalizedName.length > 50) {
    throw new Error("Tag name cannot exceed 50 characters");
  }

  // First, verify the brief belongs to the user
  const briefCheck = await sql`
    SELECT id FROM digests WHERE id = ${briefId} AND user_id = ${userId}
  `;
  if (briefCheck.rows.length === 0) {
    throw new Error("Brief not found");
  }

  // Check current tag count for this brief
  const countResult = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM digest_tags WHERE digest_id = ${briefId}
  `;
  if (parseInt(countResult.rows[0].count, 10) >= 20) {
    throw new Error("Maximum of 20 tags per brief");
  }

  // Insert or get the tag
  const tagResult = await sql<Tag>`
    INSERT INTO tags (user_id, name)
    VALUES (${userId}, ${normalizedName})
    ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name
  `;
  const tag = tagResult.rows[0];

  // Link tag to brief (ignore if already linked)
  await sql`
    INSERT INTO digest_tags (digest_id, tag_id)
    VALUES (${briefId}, ${tag.id})
    ON CONFLICT (digest_id, tag_id) DO NOTHING
  `;

  return tag;
}

/**
 * Remove a tag from a brief
 * Only removes the association, not the tag itself
 */
export async function removeTagFromBrief(
  userId: string,
  briefId: string,
  tagId: string
): Promise<boolean> {
  // Verify ownership through the digests table
  const result = await sql`
    DELETE FROM digest_tags
    WHERE digest_id = ${briefId}
      AND tag_id = ${tagId}
      AND EXISTS (
        SELECT 1 FROM digests WHERE id = ${briefId} AND user_id = ${userId}
      )
  `;
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a tag entirely from a user's vocabulary
 * Also removes all associations with briefs
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
