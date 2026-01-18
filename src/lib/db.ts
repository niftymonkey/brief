import { sql } from "@vercel/postgres";
import type {
  DbDigest,
  DigestSummary,
  VideoMetadata,
  StructuredDigest,
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
 * Save a new digest to the database
 */
export async function saveDigest(
  userId: string,
  metadata: VideoMetadata,
  digest: StructuredDigest
): Promise<DbDigest> {
  const startTime = Date.now();
  console.log(`[DB] saveDigest called, userId: ${userId}, videoId: ${metadata.videoId}`);

  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);

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
      tangents,
      related_links,
      other_links
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
      ${digest.tangents ? JSON.stringify(digest.tangents) : null},
      ${JSON.stringify(digest.relatedLinks)},
      ${JSON.stringify(digest.otherLinks)}
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
      tangents,
      related_links as "relatedLinks",
      other_links as "otherLinks",
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
  digest: StructuredDigest
): Promise<DbDigest> {
  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);

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
      tangents = ${digest.tangents ? JSON.stringify(digest.tangents) : null},
      related_links = ${JSON.stringify(digest.relatedLinks)},
      other_links = ${JSON.stringify(digest.otherLinks)},
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
      tangents,
      related_links as "relatedLinks",
      other_links as "otherLinks",
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
        tangents,
        related_links as "relatedLinks",
        other_links as "otherLinks",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM digests
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return result.rows[0] || null;
  }

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
      tangents,
      related_links as "relatedLinks",
      other_links as "otherLinks",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM digests
    WHERE id = ${id}
  `;

  return result.rows[0] || null;
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
        tangents,
        related_links as "relatedLinks",
        other_links as "otherLinks",
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
        tangents,
        related_links as "relatedLinks",
        other_links as "otherLinks",
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
      tangents,
      related_links,
      other_links
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
      ${sourceDigest.tangents ? JSON.stringify(sourceDigest.tangents) : null},
      ${JSON.stringify(sourceDigest.relatedLinks)},
      ${JSON.stringify(sourceDigest.otherLinks)}
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
      tangents,
      related_links as "relatedLinks",
      other_links as "otherLinks",
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
 * Get recent digests for a specific user with optional search
 */
export async function getDigests(options: {
  userId: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ digests: DigestSummary[]; total: number; hasMore: boolean }> {
  const { userId, limit = 20, offset = 0, search } = options;

  let digests: DigestSummary[];
  let total: number;

  if (search) {
    const searchPattern = `%${search}%`;

    const countResult = await sql<{ count: string }>`
      SELECT COUNT(*) as count
      FROM digests
      WHERE user_id = ${userId}
        AND (title ILIKE ${searchPattern} OR channel_name ILIKE ${searchPattern})
    `;
    total = parseInt(countResult.rows[0].count, 10);

    const result = await sql<DigestSummary>`
      SELECT
        id,
        video_id as "videoId",
        title,
        channel_name as "channelName",
        thumbnail_url as "thumbnailUrl",
        created_at as "createdAt"
      FROM digests
      WHERE user_id = ${userId}
        AND (title ILIKE ${searchPattern} OR channel_name ILIKE ${searchPattern})
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    digests = result.rows;
  } else {
    const countResult = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM digests WHERE user_id = ${userId}
    `;
    total = parseInt(countResult.rows[0].count, 10);

    const result = await sql<DigestSummary>`
      SELECT
        id,
        video_id as "videoId",
        title,
        channel_name as "channelName",
        thumbnail_url as "thumbnailUrl",
        created_at as "createdAt"
      FROM digests
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    digests = result.rows;
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

