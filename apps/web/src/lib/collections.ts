import { randomBytes } from "crypto";
import { sql } from "@vercel/postgres";

export type SummaryStatus = "pending" | "ready" | "failed";

export interface CollectionItem {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
  videoTitle: string | null;
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

interface CollectionItemRow {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
  videoTitle: string | null;
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
    summary: row.summary,
    summaryStatus: row.summaryStatus,
    position: row.position,
  };
}

async function collectionSlugExists(slug: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS(SELECT 1 FROM collections WHERE slug = ${slug}) as exists
  `;
  return result.rows[0]?.exists ?? false;
}

async function getSnapshotVideoTitle(userId: string, videoId: string): Promise<string | null> {
  const result = await sql<{ title: string }>`
    SELECT title
    FROM digests
    WHERE user_id = ${userId} AND video_id = ${videoId} AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return result.rows[0]?.title ?? null;
}

async function getItemPosition(
  userId: string,
  collectionId: string,
  itemId: string,
): Promise<number | null> {
  const result = await sql<{ position: number }>`
    SELECT ci.position
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.id = ${collectionId} AND c.user_id = ${userId} AND ci.id = ${itemId}
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
  const collection = await getCollectionBase(userId, collectionId);
  if (!collection) return null;

  const items = await sql<CollectionItemRow>`
    SELECT
      id,
      video_id as "videoId",
      start_sec as "startSec",
      end_sec as "endSec",
      video_title as "videoTitle",
      summary,
      summary_status as "summaryStatus",
      position
    FROM collection_items
    WHERE collection_id = ${collectionId}
    ORDER BY position ASC, created_at ASC
  `;

  return { ...collection, items: items.rows.map(toCollectionItem) };
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
  const collectionResult = await sql<CollectionRow>`
    SELECT
      c.id,
      c.title,
      c.description,
      c.is_shared as "isShared",
      c.slug,
      COUNT(ci.id)::int as "itemCount"
    FROM collections c
    LEFT JOIN collection_items ci ON ci.collection_id = c.id
    WHERE c.slug = ${slug} AND c.is_shared = TRUE
    GROUP BY c.id
  `;
  const collection = collectionResult.rows[0] ? toCollection(collectionResult.rows[0]) : null;
  if (!collection) return null;

  const itemsResult = await sql<CollectionItemRow>`
    SELECT
      id,
      video_id as "videoId",
      start_sec as "startSec",
      end_sec as "endSec",
      video_title as "videoTitle",
      summary,
      summary_status as "summaryStatus",
      position
    FROM collection_items
    WHERE collection_id = ${collection.id}
    ORDER BY position ASC, created_at ASC
  `;
  return { ...collection, items: itemsResult.rows.map(toCollectionItem) };
}

export async function addCollectionItem(
  userId: string,
  collectionId: string,
  input: AddCollectionItemInput,
): Promise<CollectionItem | null> {
  const videoTitle = await getSnapshotVideoTitle(userId, input.videoId);
  const summaryStatus: SummaryStatus = input.summary === undefined ? "pending" : "ready";

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
        summary,
        summary_status,
        position
      )
      SELECT
        ${collectionId},
        ${input.videoId},
        ${input.startSec ?? null},
        ${input.endSec ?? null},
        ${videoTitle},
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

export async function updateCollectionItem(
  userId: string,
  collectionId: string,
  itemId: string,
  input: UpdateCollectionItemInput,
): Promise<CollectionItem | null> {
  const currentResult = await sql<CollectionItemRow>`
    SELECT
      ci.id,
      ci.video_id as "videoId",
      ci.start_sec as "startSec",
      ci.end_sec as "endSec",
      ci.video_title as "videoTitle",
      ci.summary,
      ci.summary_status as "summaryStatus",
      ci.position
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.id = ${collectionId} AND c.user_id = ${userId} AND ci.id = ${itemId}
  `;
  const current = currentResult.rows[0] ? toCollectionItem(currentResult.rows[0]) : null;
  if (!current) return null;

  const changesPointer =
    input.videoId !== undefined ||
    input.startSec !== undefined ||
    input.endSec !== undefined;
  const changesSummary = input.summary !== undefined;
  const reorders =
    input.beforeItemId !== undefined ||
    input.afterItemId !== undefined;

  let position = current.position;
  if (reorders) {
    const afterPosition = input.afterItemId
      ? await getItemPosition(userId, collectionId, input.afterItemId)
      : null;
    const beforePosition = input.beforeItemId
      ? await getItemPosition(userId, collectionId, input.beforeItemId)
      : null;

    if ((input.afterItemId && afterPosition === null) || (input.beforeItemId && beforePosition === null)) {
      return null;
    }

    position = midpointPosition(afterPosition, beforePosition);
  }

  const newVideoTitle = changesPointer
    ? await getSnapshotVideoTitle(userId, input.videoId ?? current.videoId)
    : null;

  const updateVideoId = input.videoId !== undefined;
  const updateStart = input.startSec !== undefined;
  const updateEnd = input.endSec !== undefined;

  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const result = await client.sql<CollectionItemRow>`
      UPDATE collection_items ci
      SET
        video_id = CASE WHEN ${updateVideoId}::boolean THEN ${input.videoId ?? null}::varchar ELSE ci.video_id END,
        start_sec = CASE WHEN ${updateStart}::boolean THEN ${input.startSec ?? null}::int ELSE ci.start_sec END,
        end_sec = CASE WHEN ${updateEnd}::boolean THEN ${input.endSec ?? null}::int ELSE ci.end_sec END,
        video_title = CASE WHEN ${changesPointer}::boolean THEN ${newVideoTitle}::text ELSE ci.video_title END,
        summary = CASE
          WHEN ${changesPointer}::boolean THEN NULL
          WHEN ${changesSummary}::boolean THEN ${input.summary ?? null}::text
          ELSE ci.summary
        END,
        summary_status = CASE
          WHEN ${changesPointer}::boolean THEN 'pending'
          WHEN ${changesSummary}::boolean THEN 'ready'
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
