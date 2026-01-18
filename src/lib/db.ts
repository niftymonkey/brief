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
  metadata: VideoMetadata,
  digest: StructuredDigest
): Promise<DbDigest> {
  const channelSlug = createSlug(metadata.channelTitle);
  const thumbnailUrl = getThumbnailUrl(metadata.videoId);

  const result = await sql<DbDigest>`
    INSERT INTO digests (
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
 * Update an existing digest (for refreshing stale digests)
 */
export async function updateDigest(
  videoId: string,
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
    WHERE video_id = ${videoId}
    RETURNING
      id,
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
 * Get a digest by ID
 */
export async function getDigestById(id: string): Promise<DbDigest | null> {
  const result = await sql<DbDigest>`
    SELECT
      id,
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
 * Get a digest by video ID
 */
export async function getDigestByVideoId(
  videoId: string
): Promise<DbDigest | null> {
  const result = await sql<DbDigest>`
    SELECT
      id,
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

  return result.rows[0] || null;
}

/**
 * Get recent digests with optional search
 */
export async function getDigests(options: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ digests: DigestSummary[]; total: number; hasMore: boolean }> {
  const { limit = 20, offset = 0, search } = options;

  let digests: DigestSummary[];
  let total: number;

  if (search) {
    const searchPattern = `%${search}%`;

    const countResult = await sql<{ count: string }>`
      SELECT COUNT(*) as count
      FROM digests
      WHERE title ILIKE ${searchPattern}
        OR channel_name ILIKE ${searchPattern}
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
      WHERE title ILIKE ${searchPattern}
        OR channel_name ILIKE ${searchPattern}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    digests = result.rows;
  } else {
    const countResult = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM digests
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
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    digests = result.rows;
  }

  return { digests, total, hasMore: offset + digests.length < total };
}

