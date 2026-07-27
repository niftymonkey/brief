import { randomBytes } from "crypto";
import { sql, type VercelPoolClient } from "@vercel/postgres";
import { parseDurationToSeconds } from "./chapters";
import { fetchYouTubeVideoFacts } from "./video-facts";
import { storableVideoFacts } from "./storable-video-facts";
import type { EntryVideoFacts } from "./collection-entries";

export type SummaryStatus = "pending" | "ready" | "failed";

export interface CollectionItem {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
  videoTitle: string | null;
  /**
   * Runtime of the whole source video in seconds, independent of the clip's
   * own bounds. `null` when it has never been established (a lookup failed, or
   * the video has no fixed length). Readers that total, position, or scale
   * entries against each other need it and must handle its absence.
   */
  durationSec: number | null;
  summary: string | null;
  summaryStatus: SummaryStatus;
  position: number;
}

export interface Collection {
  id: string;
  title: string;
  description: string | null;
  isShared: boolean;
  slug: string | null;
  itemCount: number;
}

export interface CollectionWithItems extends Collection {
  /** ISO timestamp of the last change to the collection or its items. */
  updatedAt: string;
  items: CollectionItem[];
}

export interface CreateCollectionInput {
  title: string;
  description?: string | null;
}

export interface UpdateCollectionInput {
  title?: string;
  description?: string | null;
}

export interface AddCollectionItemInput {
  videoId: string;
  startSec?: number | null;
  endSec?: number | null;
  summary?: string | null;
}

export interface UpdateCollectionItemInput {
  summary?: string | null;
  videoId?: string;
  startSec?: number | null;
  endSec?: number | null;
  beforeItemId?: string | null;
  afterItemId?: string | null;
}

interface CollectionRow {
  id: string;
  title: string;
  description: string | null;
  isShared: boolean;
  slug: string | null;
  itemCount: number;
}

interface CollectionDetailRow extends CollectionRow {
  updatedAt: Date;
}

interface VideoFactsRow {
  videoId: string;
  title: string | null;
  channelName: string | null;
  duration: string | null;
}

interface CollectionItemRow {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
  videoTitle: string | null;
  durationSec: number | null;
  summary: string | null;
  summaryStatus: SummaryStatus;
  position: number;
}

function createSlug(text: string, maxLength: number = 60): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, maxLength)
    .replace(/-+$/, "");

  return slug || "collection";
}

function defaultRandomSuffix(): string {
  return randomBytes(2).toString("hex");
}

/**
 * Thrown when a collection item add or update would leave startSec/endSec
 * violating the collection_items_start_sec_check, collection_items_end_sec_check,
 * or collection_items_end_after_start_check constraints. Callers should map
 * this to a 400 rather than let the underlying Postgres error surface as a 500.
 */
export class InvalidClipRangeError extends Error {
  constructor(message = "startSec must be less than or equal to endSec") {
    super(message);
    this.name = "InvalidClipRangeError";
  }
}

/**
 * Validates a clip's startSec/endSec bounds before any query runs, so a bad
 * request fails fast with a typed error instead of a raw constraint violation
 * from the database.
 */
function validateClipRange(startSec: number | null | undefined, endSec: number | null | undefined): void {
  if (startSec !== undefined && startSec !== null && startSec < 0) {
    throw new InvalidClipRangeError("startSec must be greater than or equal to 0");
  }
  if (endSec !== undefined && endSec !== null && endSec < 0) {
    throw new InvalidClipRangeError("endSec must be greater than or equal to 0");
  }
  if (
    startSec !== undefined &&
    startSec !== null &&
    endSec !== undefined &&
    endSec !== null &&
    startSec > endSec
  ) {
    throw new InvalidClipRangeError();
  }
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

export function midpointPosition(afterPosition: number | null, beforePosition: number | null): number {
  if (afterPosition === null && beforePosition === null) return 1;
  if (afterPosition === null) {
    return beforePosition === null ? 1 : beforePosition - 1;
  }
  if (beforePosition === null) return afterPosition + 1;
  return (afterPosition + beforePosition) / 2;
}

export async function chooseCollectionSlug(
  title: string,
  slugExists: (slug: string) => Promise<boolean>,
  randomSuffix: () => string = defaultRandomSuffix,
): Promise<string> {
  const baseSlug = createSlug(title);
  if (!(await slugExists(baseSlug))) {
    return baseSlug;
  }

  for (let i = 0; i < 5; i++) {
    const candidate = `${baseSlug}-${randomSuffix()}`;
    if (!(await slugExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Failed to generate unique collection slug");
}

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isShared: row.isShared,
    slug: row.slug,
    itemCount: row.itemCount,
  };
}

function toCollectionItem(row: CollectionItemRow): CollectionItem {
  return {
    id: row.id,
    videoId: row.videoId,
    startSec: row.startSec,
    endSec: row.endSec,
    videoTitle: row.videoTitle,
    durationSec: row.durationSec,
    summary: row.summary,
    summaryStatus: row.summaryStatus,
    position: row.position,
  };
}

function toVideoFacts(rows: VideoFactsRow[]): Record<string, EntryVideoFacts> {
  const facts: Record<string, EntryVideoFacts> = {};
  for (const row of rows) {
    const durationSec = row.duration ? parseDurationToSeconds(row.duration) : 0;
    facts[row.videoId] = {
      title: row.title,
      channelName: row.channelName,
      durationSec: durationSec > 0 ? durationSec : null,
    };
  }
  return facts;
}

async function collectionSlugExists(slug: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS(SELECT 1 FROM collections WHERE slug = ${slug}) as exists
  `;
  return result.rows[0]?.exists ?? false;
}

/**
 * What a collection item records about the video it points at, beyond the ID
 * itself. Fields are independently nullable and stored verbatim, so a partial
 * answer still saves the row.
 */
export interface ResolvedVideoFacts {
  title: string | null;
  durationSec: number | null;
}

/**
 * Resolves the stored facts for a video a collection item points at. Every
 * field it cannot establish comes back `null`, which the item stores as-is so
 * the row still saves.
 */
export type VideoFactsResolver = (userId: string, videoId: string) => Promise<ResolvedVideoFacts>;

const NO_VIDEO_FACTS: ResolvedVideoFacts = { title: null, durationSec: null };

/**
 * Facts drawn from the user's most recent completed brief for this video, if
 * they have ever briefed it. Only a fallback: a brief is a snapshot from
 * whenever it was generated, so its title can be stale if the video has since
 * been retitled. `digests.duration` holds YouTube's ISO 8601 string, which is
 * parsed here so both sources speak seconds.
 */
async function getBriefedVideoFacts(userId: string, videoId: string): Promise<ResolvedVideoFacts> {
  const result = await sql<{ title: string; duration: string | null }>`
    SELECT title, duration
    FROM digests
    WHERE user_id = ${userId} AND video_id = ${videoId} AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const brief = result.rows[0];
  if (!brief) return NO_VIDEO_FACTS;

  const durationSec = brief.duration ? parseDurationToSeconds(brief.duration) : 0;
  return {
    title: brief.title ?? null,
    durationSec: durationSec > 0 ? durationSec : null,
  };
}

/**
 * The metadata source for collection items. YouTube is authoritative:
 * collections accept any video, briefed or not, so asking YouTube is the only
 * source that answers for the ordinary case. The user's own brief for the same
 * video is a fallback for when YouTube cannot answer (no API key, quota
 * exhausted, network fault), since possibly-stale facts still beat showing a
 * raw video ID with no runtime.
 *
 * Title and runtime arrive together from one `fetchMetadata` call, so asking
 * for both costs no more than asking for the title alone. That call is not
 * free: it issues a `videos.list` request and then waits on a
 * `commentThreads.list` request for a pinned comment nothing here reads, so it
 * spends two quota units where the brief-table lookup it replaced spent none.
 * The fallback query only runs when that call left a field unanswered, and
 * fills the missing fields individually.
 */
export const resolveCollectionVideoFacts: VideoFactsResolver = async (userId, videoId) => {
  const live = await fetchYouTubeVideoFacts(videoId);
  if (live.title !== null && live.durationSec !== null) return live;

  const briefed = await getBriefedVideoFacts(userId, videoId);
  return {
    title: live.title ?? briefed.title,
    durationSec: live.durationSec ?? briefed.durationSec,
  };
};

/**
 * Runs a facts resolver such that no answer of any shape can reach the caller
 * as a failure. Storing the facts is a nicety; adding or editing the clip is
 * the user's actual intent, so a metadata fault degrades every field to `null`
 * and never unwinds the write.
 *
 * That covers a resolver that throws and a resolver that returns a value the
 * columns cannot store. `VideoFactsResolver` is an injectable seam, so its
 * numeric and textual domain is a promise made by whoever supplies it, not a
 * guarantee: the persistence boundary enforces it here instead of trusting it.
 */
async function resolveVideoFactsSafely(
  resolve: VideoFactsResolver,
  userId: string,
  videoId: string,
): Promise<ResolvedVideoFacts> {
  try {
    return storableVideoFacts(await resolve(userId, videoId));
  } catch (error) {
    console.error("[COLLECTIONS] video facts lookup failed:", error);
    return NO_VIDEO_FACTS;
  }
}

/**
 * Whether this collection is this user's, read without a lock and without the
 * item join. Cheap enough to run ahead of work that must not be reachable by a
 * stranger, and never a substitute for the locked check that authorizes a write.
 */
async function ownsCollection(userId: string, collectionId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    SELECT id FROM collections WHERE id = ${collectionId} AND user_id = ${userId}
  `;
  return result.rows.length > 0;
}

async function lockedItemPosition(
  client: VercelPoolClient,
  collectionId: string,
  itemId: string,
): Promise<number | null> {
  const result = await client.sql<{ position: number }>`
    SELECT position
    FROM collection_items
    WHERE collection_id = ${collectionId} AND id = ${itemId}
  `;
  return result.rows[0]?.position ?? null;
}

async function getCollectionBase(userId: string, collectionId: string): Promise<Collection | null> {
  const result = await sql<CollectionRow>`
    SELECT
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      COUNT(ci.id)::int as "itemCount"
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    WHERE c.id = ${collectionId} AND c.user_id = ${userId}
    GROUP BY c.id
  `;
  return result.rows[0] ? toCollection(result.rows[0]) : null;
}

/**
 * Fetches one collection the user owns, without its items. Returns null when
 * the collection does not exist or belongs to someone else.
 */
export async function getCollection(
  userId: string,
  collectionId: string,
): Promise<Collection | null> {
  return getCollectionBase(userId, collectionId);
}

export async function createCollection(
  userId: string,
  input: CreateCollectionInput,
): Promise<Collection> {
  const result = await sql<CollectionRow>`
    INSERT INTO collections (user_id, title, description)
    VALUES (${userId}, ${input.title}, ${input.description ?? null})
    RETURNING
      id,
      title,
      description,
      is_shared as "isShared",
      slug,
      0::int as "itemCount"
  `;
  return toCollection(result.rows[0]);
}

export async function listCollections(userId: string): Promise<Collection[]> {
  const result = await sql<CollectionRow>`
    SELECT
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      COUNT(ci.id)::int as "itemCount"
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    WHERE c.user_id = ${userId}
    GROUP BY c.id
    ORDER BY c.updated_at DESC, c.created_at DESC
  `;
  return result.rows.map(toCollection);
}

export async function getCollectionWithItems(
  userId: string,
  collectionId: string,
): Promise<CollectionWithItems | null> {
  const collectionResult = await sql<CollectionDetailRow>`
    SELECT
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      c.updated_at as "updatedAt",
      COUNT(ci.id)::int as "itemCount"
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    WHERE c.id = ${collectionId} AND c.user_id = ${userId}
    GROUP BY c.id
  `;
  const row = collectionResult.rows[0];
  if (!row) return null;
  const collection = { ...toCollection(row), updatedAt: new Date(row.updatedAt).toISOString() };

  const items = await sql<CollectionItemRow>`
    SELECT
      id,
      video_id as "videoId",
      start_sec as "startSec",
      end_sec as "endSec",
      video_title as "videoTitle",
      duration_sec as "durationSec",
      summary,
      summary_status as "summaryStatus",
      position
    FROM collection_items
    WHERE collection_id = ${collectionId}
    ORDER BY position ASC, id ASC
  `;

  return { ...collection, items: items.rows.map(toCollectionItem) };
}

/**
 * What the viewer's own briefs know about the videos a collection points at,
 * keyed by video id. A collection may hold videos that were never briefed, so a
 * video with no completed brief is simply absent from the result rather than
 * carrying empty fields.
 */
export async function getCollectionVideoFacts(
  userId: string,
  videoIds: string[],
): Promise<Record<string, EntryVideoFacts>> {
  const unique = [...new Set(videoIds)];
  if (unique.length === 0) return {};

  const placeholders = unique.map((_, index) => `$${index + 2}`).join(", ");
  const result = await sql.query<VideoFactsRow>(
    `
    SELECT DISTINCT ON (video_id)
      video_id as "videoId",
      title,
      channel_name as "channelName",
      duration
    FROM digests
    WHERE user_id = $1
      AND status = 'completed'
      AND video_id IN (${placeholders})
    ORDER BY video_id, created_at DESC
    `,
    [userId, ...unique],
  );

  return toVideoFacts(result.rows);
}

/**
 * What a shared collection's own curator knows about the videos it points at,
 * keyed by video id, for readers who have no briefs of their own. Resolved
 * through the collection's owner so a public reader sees the same titles,
 * channels and lengths the curator does.
 *
 * Two gates make this safe to reach from an unauthenticated page: the
 * collection must be shared, and each video must be an entry of that very
 * collection. Both live in the SQL, so the caller's `videoIds` only ever
 * narrows the result and can never widen it into the owner's wider library.
 */
export async function getSharedCollectionVideoFacts(
  collectionId: string,
  videoIds: string[],
): Promise<Record<string, EntryVideoFacts>> {
  const unique = [...new Set(videoIds)];
  if (unique.length === 0) return {};

  const placeholders = unique.map((_, index) => `$${index + 2}`).join(", ");
  const result = await sql.query<VideoFactsRow>(
    `
    SELECT DISTINCT ON (d.video_id)
      d.video_id as "videoId",
      d.title,
      d.channel_name as "channelName",
      d.duration
    FROM digests d
    JOIN collections c ON c.user_id = d.user_id
    WHERE c.id = $1
      AND c.is_shared = TRUE
      AND d.status = 'completed'
      AND EXISTS (
        SELECT 1
        FROM collection_items ci
        WHERE ci.collection_id = c.id
          AND ci.video_id = d.video_id
      )
      AND d.video_id IN (${placeholders})
    ORDER BY d.video_id, d.created_at DESC
    `,
    [collectionId, ...unique],
  );

  return toVideoFacts(result.rows);
}

export async function updateCollection(
  userId: string,
  collectionId: string,
  input: UpdateCollectionInput,
): Promise<Collection | null> {
  const updateTitle = input.title !== undefined;
  const updateDescription = input.description !== undefined;

  const result = await sql<CollectionRow>`
    UPDATE collections c
    SET
      title = CASE WHEN ${updateTitle}::boolean THEN ${input.title ?? null}::text ELSE c.title END,
      description = CASE WHEN ${updateDescription}::boolean THEN ${input.description ?? null}::text ELSE c.description END,
      updated_at = NOW()
    WHERE c.id = ${collectionId} AND c.user_id = ${userId}
    RETURNING
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      (SELECT COUNT(*)::int FROM collection_items WHERE collection_id = c.id) as "itemCount"
  `;
  return result.rows[0] ? toCollection(result.rows[0]) : null;
}

export async function deleteCollection(userId: string, collectionId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM collections WHERE id = ${collectionId} AND user_id = ${userId}
  `;
  return (result.rowCount ?? 0) > 0;
}

export async function setCollectionShared(
  userId: string,
  collectionId: string,
  isShared: boolean,
  randomSuffix: () => string = defaultRandomSuffix,
): Promise<{ isShared: boolean; slug: string | null } | null> {
  const collection = await getCollectionBase(userId, collectionId);
  if (!collection) return null;

  if (!isShared || collection.slug) {
    const result = await sql<{ isShared: boolean; slug: string | null }>`
      UPDATE collections
      SET is_shared = ${isShared}, slug = ${collection.slug}, updated_at = NOW()
      WHERE id = ${collectionId} AND user_id = ${userId}
      RETURNING is_shared as "isShared", slug
    `;
    return result.rows[0] ?? null;
  }

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = await chooseCollectionSlug(collection.title, collectionSlugExists, randomSuffix);
    try {
      const result = await sql<{ isShared: boolean; slug: string | null }>`
        UPDATE collections
        SET is_shared = ${isShared}, slug = ${slug}, updated_at = NOW()
        WHERE id = ${collectionId} AND user_id = ${userId}
        RETURNING is_shared as "isShared", slug
      `;
      return result.rows[0] ?? null;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

export async function getSharedCollectionBySlug(
  slug: string,
): Promise<CollectionWithItems | null> {
  const collectionResult = await sql<CollectionDetailRow>`
    SELECT
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      c.updated_at as "updatedAt",
      COUNT(ci.id)::int as "itemCount"
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    WHERE c.slug = ${slug} AND c.is_shared = TRUE
    GROUP BY c.id
  `;
  const row = collectionResult.rows[0];
  if (!row) return null;
  const collection = { ...toCollection(row), updatedAt: new Date(row.updatedAt).toISOString() };

  const itemsResult = await sql<CollectionItemRow>`
    SELECT
      id,
      video_id as "videoId",
      start_sec as "startSec",
      end_sec as "endSec",
      video_title as "videoTitle",
      duration_sec as "durationSec",
      summary,
      summary_status as "summaryStatus",
      position
    FROM collection_items
    WHERE collection_id = ${collection.id}
    ORDER BY position ASC, id ASC
  `;
  return { ...collection, items: itemsResult.rows.map(toCollectionItem) };
}

export async function addCollectionItem(
  userId: string,
  collectionId: string,
  input: AddCollectionItemInput,
  resolveVideoFacts: VideoFactsResolver = resolveCollectionVideoFacts,
): Promise<CollectionItem | null> {
  validateClipRange(input.startSec, input.endSec);

  // Ownership is checked twice, and both checks earn their place. The locked one
  // below is the authority on the write. This unlocked one runs first only so a
  // stranger cannot reach the lookup underneath it: that lookup spends two units
  // of the YouTube quota the whole app shares, and every signed-in user can name
  // any collection id. A miss here is a 404 the same as a miss under the lock.
  if (!(await ownsCollection(userId, collectionId))) return null;

  // Resolved before the transaction opens so the network round trip never runs
  // while the collection row is locked FOR UPDATE.
  const facts = await resolveVideoFactsSafely(resolveVideoFacts, userId, input.videoId);
  const summaryStatus: SummaryStatus =
    input.summary === undefined || input.summary === null ? "pending" : "ready";

  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const owned = await client.sql`
      SELECT id FROM collections
      WHERE id = ${collectionId} AND user_id = ${userId}
      FOR UPDATE
    `;
    if (owned.rows.length === 0) {
      await client.sql`ROLLBACK`;
      return null;
    }

    const result = await client.sql<CollectionItemRow>`
      INSERT INTO collection_items (
        collection_id,
        video_id,
        start_sec,
        end_sec,
        video_title,
        duration_sec,
        summary,
        summary_status,
        position
      )
      SELECT
        ${collectionId},
        ${input.videoId},
        ${input.startSec ?? null},
        ${input.endSec ?? null},
        ${facts.title},
        ${facts.durationSec},
        ${input.summary ?? null},
        ${summaryStatus},
        COALESCE(MAX(position), 0) + 1
      FROM collection_items
      WHERE collection_id = ${collectionId}
      RETURNING
        id,
        video_id as "videoId",
        start_sec as "startSec",
        end_sec as "endSec",
        video_title as "videoTitle",
        duration_sec as "durationSec",
        summary,
        summary_status as "summaryStatus",
        position
    `;

    await client.sql`UPDATE collections SET updated_at = NOW() WHERE id = ${collectionId}`;
    await client.sql`COMMIT`;
    return result.rows[0] ? toCollectionItem(result.rows[0]) : null;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetches a single item within a collection the user owns. Returns null when
 * the collection is not the user's or the item does not exist, so callers can
 * map both cases to a 404 without leaking whether the collection exists.
 */
export async function getCollectionItem(
  userId: string,
  collectionId: string,
  itemId: string,
): Promise<CollectionItem | null> {
  const result = await sql<CollectionItemRow>`
    SELECT
      ci.id,
      ci.video_id as "videoId",
      ci.start_sec as "startSec",
      ci.end_sec as "endSec",
      ci.video_title as "videoTitle",
      ci.duration_sec as "durationSec",
      ci.summary,
      ci.summary_status as "summaryStatus",
      ci.position
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.id = ${collectionId} AND c.user_id = ${userId} AND ci.id = ${itemId}
  `;
  return result.rows[0] ? toCollectionItem(result.rows[0]) : null;
}

/**
 * Outcome of the async per-item summary generation path: either the generated
 * summary text (status 'ready') or a generation failure (status 'failed').
 */
export type GeneratedSummaryOutcome =
  | { status: "ready"; summary: string }
  | { status: "failed" };

/**
 * Persists the result of the async generation path onto an item, with one hard
 * invariant: a summary whose status is already 'ready' is never overwritten.
 * That protects an author's hand-edited summary from being clobbered by a
 * generation call that completes late (or a retry racing an edit). A 'ready'
 * summary is always the authoritative one, whether machine- or hand-written.
 *
 * Pending and failed items are advanced normally, so a retry off a 'failed'
 * item can still land a summary. Returns the item's resulting state (unchanged
 * when the guard blocked the write), or null when the item is not the user's.
 */
export async function writeGeneratedSummary(
  userId: string,
  collectionId: string,
  itemId: string,
  outcome: GeneratedSummaryOutcome,
): Promise<CollectionItem | null> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const owned = await client.sql`
      SELECT id FROM collections
      WHERE id = ${collectionId} AND user_id = ${userId}
      FOR UPDATE
    `;
    if (owned.rows.length === 0) {
      await client.sql`ROLLBACK`;
      return null;
    }

    const nextStatus: SummaryStatus = outcome.status;
    const nextSummary = outcome.status === "ready" ? outcome.summary : null;
    const writesSummary = outcome.status === "ready";

    const updated = await client.sql<CollectionItemRow>`
      UPDATE collection_items ci
      SET
        summary = CASE WHEN ${writesSummary}::boolean THEN ${nextSummary}::text ELSE ci.summary END,
        summary_status = ${nextStatus},
        updated_at = NOW()
      WHERE ci.collection_id = ${collectionId}
        AND ci.id = ${itemId}
        AND ci.summary_status <> 'ready'
      RETURNING
        ci.id,
        ci.video_id as "videoId",
        ci.start_sec as "startSec",
        ci.end_sec as "endSec",
        ci.video_title as "videoTitle",
        ci.duration_sec as "durationSec",
        ci.summary,
        ci.summary_status as "summaryStatus",
        ci.position
    `;

    if (updated.rows.length > 0) {
      await client.sql`COMMIT`;
      return toCollectionItem(updated.rows[0]);
    }

    // No row updated: either the item is already 'ready' (guard held) or it
    // does not exist. Re-read within the transaction to return the true state.
    const current = await client.sql<CollectionItemRow>`
      SELECT
        ci.id,
        ci.video_id as "videoId",
        ci.start_sec as "startSec",
        ci.end_sec as "endSec",
        ci.video_title as "videoTitle",
        ci.duration_sec as "durationSec",
        ci.summary,
        ci.summary_status as "summaryStatus",
        ci.position
      FROM collection_items ci
      WHERE ci.collection_id = ${collectionId} AND ci.id = ${itemId}
    `;
    await client.sql`COMMIT`;
    return current.rows[0] ? toCollectionItem(current.rows[0]) : null;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCollectionItem(
  userId: string,
  collectionId: string,
  itemId: string,
  input: UpdateCollectionItemInput,
  resolveVideoFacts: VideoFactsResolver = resolveCollectionVideoFacts,
): Promise<CollectionItem | null> {
  const changesPointer =
    input.videoId !== undefined ||
    input.startSec !== undefined ||
    input.endSec !== undefined;
  const changesSummary = input.summary !== undefined;
  const summaryIsText = changesSummary && input.summary !== null;
  const reorders =
    input.beforeItemId !== undefined ||
    input.afterItemId !== undefined;

  const updateVideoId = input.videoId !== undefined;
  const updateStart = input.startSec !== undefined;
  const updateEnd = input.endSec !== undefined;

  // Resolved before the transaction opens, so the network round trip never runs
  // while the collection row is locked FOR UPDATE and every other write to the
  // collection (add, reorder, edit) waits behind it.
  //
  // The stored facts describe the video the item points at, so a lookup is only
  // worth spending when that video actually changes. The edit dialog resends the
  // current videoId whenever the author touches the clip's bounds, so gating on
  // `input.videoId !== undefined` alone would re-resolve (and on a failed
  // lookup, erase) good facts on every bounds edit. This unlocked read decides
  // only whether to spend the lookup; the locked row below decides whether to
  // apply it.
  let replacementFacts: ResolvedVideoFacts | null = null;
  if (input.videoId !== undefined) {
    const existing = await getCollectionItem(userId, collectionId, itemId);
    if (existing) {
      // The bounds a partial edit would leave behind, checked here as well as
      // under the lock below. A single-field edit passes request validation with
      // nothing to compare against, so the stored bound is what makes it valid
      // or not, and this row already carries it. Failing now costs a scoped
      // local read; failing under the lock costs the lookup first.
      validateClipRange(
        updateStart ? input.startSec ?? null : existing.startSec,
        updateEnd ? input.endSec ?? null : existing.endSec,
      );

      if (existing.videoId !== input.videoId) {
        replacementFacts = await resolveVideoFactsSafely(resolveVideoFacts, userId, input.videoId);
      }
    }
  }

  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const owned = await client.sql`
      SELECT id FROM collections
      WHERE id = ${collectionId} AND user_id = ${userId}
      FOR UPDATE
    `;
    if (owned.rows.length === 0) {
      await client.sql`ROLLBACK`;
      return null;
    }

    const currentResult = await client.sql<CollectionItemRow>`
      SELECT
        ci.id,
        ci.video_id as "videoId",
        ci.start_sec as "startSec",
        ci.end_sec as "endSec",
        ci.video_title as "videoTitle",
        ci.duration_sec as "durationSec",
        ci.summary,
        ci.summary_status as "summaryStatus",
        ci.position
      FROM collection_items ci
      WHERE ci.collection_id = ${collectionId} AND ci.id = ${itemId}
    `;
    const current = currentResult.rows[0] ? toCollectionItem(currentResult.rows[0]) : null;
    if (!current) {
      await client.sql`ROLLBACK`;
      return null;
    }

    // A partial update (e.g. startSec only) still needs validating against
    // whichever bound isn't being changed, otherwise a single-field PATCH
    // can leave the row violating collection_items_end_after_start_check.
    const finalStartSec = updateStart ? input.startSec ?? null : current.startSec;
    const finalEndSec = updateEnd ? input.endSec ?? null : current.endSec;
    validateClipRange(finalStartSec, finalEndSec);

    let position = current.position;
    if (reorders) {
      const afterPosition = input.afterItemId
        ? await lockedItemPosition(client, collectionId, input.afterItemId)
        : null;
      const beforePosition = input.beforeItemId
        ? await lockedItemPosition(client, collectionId, input.beforeItemId)
        : null;

      if ((input.afterItemId && afterPosition === null) || (input.beforeItemId && beforePosition === null)) {
        await client.sql`ROLLBACK`;
        return null;
      }

      position = midpointPosition(afterPosition, beforePosition);
    }

    // The locked row is the authority on whether the video is really changing,
    // so the pre-resolved facts are applied only when it agrees. When it does
    // not (another writer moved this item between the unlocked read and the
    // lock), `replacementFacts` describes a different video than the one being
    // stored, and no facts is the honest record rather than that writer's.
    const refreshesFacts = input.videoId !== undefined && input.videoId !== current.videoId;
    const newFacts = refreshesFacts ? (replacementFacts ?? NO_VIDEO_FACTS) : NO_VIDEO_FACTS;

    const result = await client.sql<CollectionItemRow>`
      UPDATE collection_items ci
      SET
        video_id = CASE WHEN ${updateVideoId}::boolean THEN ${input.videoId ?? null}::varchar ELSE ci.video_id END,
        start_sec = CASE WHEN ${updateStart}::boolean THEN ${input.startSec ?? null}::int ELSE ci.start_sec END,
        end_sec = CASE WHEN ${updateEnd}::boolean THEN ${input.endSec ?? null}::int ELSE ci.end_sec END,
        video_title = CASE WHEN ${refreshesFacts}::boolean THEN ${newFacts.title}::text ELSE ci.video_title END,
        duration_sec = CASE WHEN ${refreshesFacts}::boolean THEN ${newFacts.durationSec}::int ELSE ci.duration_sec END,
        summary = CASE
          WHEN ${changesPointer}::boolean THEN NULL
          WHEN ${changesSummary}::boolean THEN ${input.summary ?? null}::text
          ELSE ci.summary
        END,
        summary_status = CASE
          WHEN ${changesPointer}::boolean THEN 'pending'
          WHEN ${summaryIsText}::boolean THEN 'ready'
          WHEN ${changesSummary}::boolean THEN 'pending'
          ELSE ci.summary_status
        END,
        position = CASE WHEN ${reorders}::boolean THEN ${position}::double precision ELSE ci.position END,
        updated_at = NOW()
      FROM collections c
      WHERE c.id = ci.collection_id
        AND c.id = ${collectionId}
        AND c.user_id = ${userId}
        AND ci.id = ${itemId}
      RETURNING
        ci.id,
        ci.video_id as "videoId",
        ci.start_sec as "startSec",
        ci.end_sec as "endSec",
        ci.video_title as "videoTitle",
        ci.duration_sec as "durationSec",
        ci.summary,
        ci.summary_status as "summaryStatus",
        ci.position
    `;

    if (result.rows.length === 0) {
      await client.sql`ROLLBACK`;
      return null;
    }

    await client.sql`UPDATE collections SET updated_at = NOW() WHERE id = ${collectionId}`;
    await client.sql`COMMIT`;
    return toCollectionItem(result.rows[0]);
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteCollectionItem(
  userId: string,
  collectionId: string,
  itemId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM collection_items ci
    USING collections c
    WHERE c.id = ci.collection_id
      AND c.id = ${collectionId}
      AND c.user_id = ${userId}
      AND ci.id = ${itemId}
  `;

  if ((result.rowCount ?? 0) > 0) {
    await sql`UPDATE collections SET updated_at = NOW() WHERE id = ${collectionId}`;
    return true;
  }
  return false;
}
