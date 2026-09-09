import { sql } from "@vercel/postgres";

/**
 * A standing subject a person follows, with the schedule and per-Run ceilings
 * that shape its Runs. `channelCount` and `queryCount` describe the feeds
 * pointing at it without carrying them.
 */
export interface Topic {
  id: string;
  name: string;
  /**
   * Addresses `/topics/<slug>` inside one owner's account, and is unique per
   * user rather than globally. Minted from the name at creation and stable
   * across renames, so a saved link keeps working; only an explicit slug edit
   * changes it.
   */
  slug: string;
  interests: string | null;
  isActive: boolean;
  cadenceDays: number;
  windowDays: number;
  maxStandingQueries: number;
  maxProbesPerRun: number;
  maxGroupsPerRun: number;
  maxVideosPerGroup: number;
  maxChannelVideosPerRun: number;
  channelCount: number;
  queryCount: number;
}

/**
 * The per-Run ceilings a Topic can carry. Each one has a floor its column
 * enforces, so the fields travel together and are validated together.
 */
/**
 * A Topic together with the feeds pointing at it, for the page that edits both.
 */
export interface TopicWithFeeds extends Topic {
  channels: TopicChannel[];
  queries: TopicQuery[];
}

export interface TopicCaps {
  maxStandingQueries?: number;
  maxProbesPerRun?: number;
  maxGroupsPerRun?: number;
  maxVideosPerGroup?: number;
  maxChannelVideosPerRun?: number;
}

export interface CreateTopicInput extends TopicCaps {
  name: string;
  interests?: string | null;
  cadenceDays?: number;
  windowDays?: number;
}

/**
 * A Topic edit. Every field is optional and only the ones present change, so a
 * form that touches one setting cannot quietly reset the rest. `slug` is here
 * because a person who wants a different URL can ask for one; renaming through
 * `name` leaves the slug alone.
 */
export interface UpdateTopicInput extends TopicCaps {
  name?: string;
  slug?: string;
  interests?: string | null;
  isActive?: boolean;
  cadenceDays?: number;
  windowDays?: number;
}

/**
 * How a channel came to be on a Topic: ticked from a subscriptions export
 * ('takeout'), typed in by hand ('manual'), or accepted from a suggestion
 * ('suggested'). The three values topic_channels_added_via_check permits.
 */
export type TopicChannelSource = "takeout" | "manual" | "suggested";

export interface TopicChannel {
  id: string;
  youtubeChannelId: string;
  channelTitle: string | null;
  channelUrl: string | null;
  addedVia: TopicChannelSource;
}

export interface AddTopicChannelInput {
  youtubeChannelId: string;
  channelTitle?: string | null;
  channelUrl?: string | null;
  /** Defaults to 'manual', which is what adding one channel at a time is. */
  addedVia?: TopicChannelSource;
}

/**
 * One ticked row of a subscriptions export. Title and URL are whatever the CSV
 * carried, so both are optional and stored verbatim.
 */
export interface TakeoutChannelInput {
  youtubeChannelId: string;
  channelTitle?: string | null;
  channelUrl?: string | null;
}

interface TopicChannelRow {
  id: string;
  youtubeChannelId: string;
  channelTitle: string | null;
  channelUrl: string | null;
  addedVia: TopicChannelSource;
}

export interface TopicQuery {
  id: string;
  query: string;
}

interface TopicQueryRow {
  id: string;
  query: string;
}

interface TopicRow {
  id: string;
  name: string;
  slug: string;
  interests: string | null;
  isActive: boolean;
  cadenceDays: number;
  windowDays: number;
  maxStandingQueries: number;
  maxProbesPerRun: number;
  maxGroupsPerRun: number;
  maxVideosPerGroup: number;
  maxChannelVideosPerRun: number;
  channelCount: number;
  queryCount: number;
}

const SLUG_MAX_LENGTH = 60;

/**
 * The slug every Topic falls back to when its name carries no character a slug
 * can keep: a name of pure punctuation, or one written entirely outside the
 * ASCII alphabet. The slug addresses `/topics/<slug>`, so an empty string is
 * never an option.
 */
const FALLBACK_SLUG = "topic";

function createSlug(text: string, maxLength: number = SLUG_MAX_LENGTH): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, maxLength)
    .replace(/-+$/, "");

  return slug || FALLBACK_SLUG;
}

/**
 * Mints the slug for a new Topic from its name, stepping through numeric
 * suffixes until `slugExists` reports one free. Suffixes are readable and
 * ordered rather than random because a Topic slug is only unique inside one
 * owner's account, so the second "Rust" a person follows becomes `rust-2`
 * rather than acquiring four hex characters they then have to read.
 */
export async function chooseTopicSlug(
  name: string,
  slugExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const baseSlug = createSlug(name);
  if (!(await slugExists(baseSlug))) {
    return baseSlug;
  }

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${createSlug(name, SLUG_MAX_LENGTH - `-${suffix}`.length)}-${suffix}`;
    if (!(await slugExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Failed to generate unique topic slug");
}

function toTopicChannel(row: TopicChannelRow): TopicChannel {
  return {
    id: row.id,
    youtubeChannelId: row.youtubeChannelId,
    channelTitle: row.channelTitle,
    channelUrl: row.channelUrl,
    addedVia: row.addedVia,
  };
}

function toTopicQuery(row: TopicQueryRow): TopicQuery {
  return { id: row.id, query: row.query };
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    interests: row.interests,
    isActive: row.isActive,
    cadenceDays: row.cadenceDays,
    windowDays: row.windowDays,
    maxStandingQueries: row.maxStandingQueries,
    maxProbesPerRun: row.maxProbesPerRun,
    maxGroupsPerRun: row.maxGroupsPerRun,
    maxVideosPerGroup: row.maxVideosPerGroup,
    maxChannelVideosPerRun: row.maxChannelVideosPerRun,
    channelCount: row.channelCount,
    queryCount: row.queryCount,
  };
}

/**
 * Thrown when a cadence and window pair would violate topics_cadence_days_check
 * or topics_window_days_check. A window narrower than the cadence leaves days
 * that no Run ever reads, so a video published in the gap is missed permanently
 * rather than merely late. Callers should map this to a 400 rather than let the
 * underlying Postgres error surface as a 500.
 */
export class InvalidTopicScheduleError extends Error {
  constructor(message = "windowDays must be greater than or equal to cadenceDays") {
    super(message);
    this.name = "InvalidTopicScheduleError";
  }
}

/**
 * Thrown when a per-Run cap falls below the floor its column enforces. Same
 * contract as InvalidTopicScheduleError: a 400 for the caller, not a raw
 * constraint violation.
 */
export class InvalidTopicCapError extends Error {
  constructor(message = "a per-run cap is below its permitted floor") {
    super(message);
    this.name = "InvalidTopicCapError";
  }
}

function validateTopicSchedule(cadenceDays: number, windowDays: number): void {
  if (!Number.isInteger(cadenceDays) || cadenceDays < 1) {
    throw new InvalidTopicScheduleError("cadenceDays must be a whole number of at least 1");
  }
  if (!Number.isInteger(windowDays)) {
    throw new InvalidTopicScheduleError("windowDays must be a whole number");
  }
  if (windowDays < cadenceDays) {
    throw new InvalidTopicScheduleError();
  }
}

function validateTopicCap(label: string, value: number | undefined, floor: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < floor) {
    throw new InvalidTopicCapError(`${label} must be a whole number of at least ${floor}`);
  }
}

function validateTopicCaps(caps: TopicCaps): void {
  validateTopicCap("maxStandingQueries", caps.maxStandingQueries, 0);
  validateTopicCap("maxProbesPerRun", caps.maxProbesPerRun, 0);
  validateTopicCap("maxGroupsPerRun", caps.maxGroupsPerRun, 1);
  validateTopicCap("maxVideosPerGroup", caps.maxVideosPerGroup, 1);
  validateTopicCap("maxChannelVideosPerRun", caps.maxChannelVideosPerRun, 1);
}

/**
 * Thrown when a Topic already holds as many standing queries as its own
 * max_standing_queries allows. A refusal, not a silent no-op: the caller has to
 * tell the person their query was not saved, and that raising the cap or
 * dropping a query is what makes room.
 */
export class TopicQueryLimitError extends Error {
  constructor(message = "this topic is already at its standing query limit") {
    super(message);
    this.name = "TopicQueryLimitError";
  }
}

/**
 * Thrown when an edit would give a Topic two standing queries with the same text,
 * which `idx_topic_queries_unique` forbids. Same contract as the errors above: a
 * 400 the caller can put into words, not a raw constraint violation.
 */
export class DuplicateTopicQueryError extends Error {
  constructor(message = "this topic already holds that standing query") {
    super(message);
    this.name = "DuplicateTopicQueryError";
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

/**
 * Whether this user already holds a Topic at this slug. Scoped to the one user
 * because `idx_topics_user_slug` is per user: two people following Rust both get
 * `rust`, and neither learns what the other named their Topics.
 */
async function topicSlugExists(userId: string, slug: string): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS(
      SELECT 1 FROM topics WHERE user_id = ${userId} AND slug = ${slug}
    ) as exists
  `;
  return result.rows[0]?.exists ?? false;
}

export async function createTopic(userId: string, input: CreateTopicInput): Promise<Topic> {
  validateTopicSchedule(input.cadenceDays ?? 3, input.windowDays ?? 7);
  validateTopicCaps(input);

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = await chooseTopicSlug(input.name, (candidate) =>
      topicSlugExists(userId, candidate),
    );

    try {
      const result = await sql<TopicRow>`
        INSERT INTO topics (
          user_id,
          name,
          slug,
          interests,
          cadence_days,
          window_days,
          max_standing_queries,
          max_probes_per_run,
          max_groups_per_run,
          max_videos_per_group,
          max_channel_videos_per_run
        )
        VALUES (
          ${userId},
          ${input.name},
          ${slug},
          ${input.interests ?? null},
          ${input.cadenceDays ?? 3},
          ${input.windowDays ?? 7},
          ${input.maxStandingQueries ?? 10},
          ${input.maxProbesPerRun ?? 5},
          ${input.maxGroupsPerRun ?? 4},
          ${input.maxVideosPerGroup ?? 3},
          ${input.maxChannelVideosPerRun ?? 10}
        )
        RETURNING
          id,
          name,
          slug,
          interests,
          is_active as "isActive",
          cadence_days as "cadenceDays",
          window_days as "windowDays",
          max_standing_queries as "maxStandingQueries",
          max_probes_per_run as "maxProbesPerRun",
          max_groups_per_run as "maxGroupsPerRun",
          max_videos_per_group as "maxVideosPerGroup",
          max_channel_videos_per_run as "maxChannelVideosPerRun",
          0::int as "channelCount",
          0::int as "queryCount"
      `;
      return toTopic(result.rows[0]);
    } catch (error) {
      // Another writer took this slug between the probe and the insert. Probing
      // again from the current state is the whole fix, so only the last attempt
      // surfaces the violation.
      if (isUniqueViolation(error) && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to create topic with a unique slug");
}

export async function listTopics(userId: string): Promise<Topic[]> {
  const result = await sql<TopicRow>`
    SELECT
      t.id,
      t.name,
      t.slug,
      t.interests,
      t.is_active as "isActive",
      t.cadence_days as "cadenceDays",
      t.window_days as "windowDays",
      t.max_standing_queries as "maxStandingQueries",
      t.max_probes_per_run as "maxProbesPerRun",
      t.max_groups_per_run as "maxGroupsPerRun",
      t.max_videos_per_group as "maxVideosPerGroup",
      t.max_channel_videos_per_run as "maxChannelVideosPerRun",
      (SELECT COUNT(*)::int FROM topic_channels WHERE topic_id = t.id) as "channelCount",
      (SELECT COUNT(*)::int FROM topic_queries WHERE topic_id = t.id) as "queryCount"
    FROM topics t
    WHERE t.user_id = ${userId}
    ORDER BY t.updated_at DESC, t.created_at DESC
  `;
  return result.rows.map(toTopic);
}

/**
 * Fetches one Topic the user owns, addressed the way its page is. Returns null
 * when no such slug exists for this user and when it belongs to someone else,
 * so a caller cannot tell the two apart.
 */
export async function getTopicBySlug(userId: string, slug: string): Promise<Topic | null> {
  const result = await sql<TopicRow>`
    SELECT
      t.id,
      t.name,
      t.slug,
      t.interests,
      t.is_active as "isActive",
      t.cadence_days as "cadenceDays",
      t.window_days as "windowDays",
      t.max_standing_queries as "maxStandingQueries",
      t.max_probes_per_run as "maxProbesPerRun",
      t.max_groups_per_run as "maxGroupsPerRun",
      t.max_videos_per_group as "maxVideosPerGroup",
      t.max_channel_videos_per_run as "maxChannelVideosPerRun",
      (SELECT COUNT(*)::int FROM topic_channels WHERE topic_id = t.id) as "channelCount",
      (SELECT COUNT(*)::int FROM topic_queries WHERE topic_id = t.id) as "queryCount"
    FROM topics t
    WHERE t.slug = ${slug} AND t.user_id = ${userId}
  `;
  return result.rows[0] ? toTopic(result.rows[0]) : null;
}

/**
 * Applies an edit to a Topic the user owns and returns its resulting state, or
 * null when the Topic does not exist or is someone else's.
 */
export async function updateTopic(
  userId: string,
  topicId: string,
  input: UpdateTopicInput,
): Promise<Topic | null> {
  const updateName = input.name !== undefined;
  const updateSlug = input.slug !== undefined;
  const updateInterests = input.interests !== undefined;
  const updateIsActive = input.isActive !== undefined;
  const updateCadence = input.cadenceDays !== undefined;
  const updateWindow = input.windowDays !== undefined;
  const updateStandingQueries = input.maxStandingQueries !== undefined;
  const updateProbes = input.maxProbesPerRun !== undefined;
  const updateGroups = input.maxGroupsPerRun !== undefined;
  const updateVideosPerGroup = input.maxVideosPerGroup !== undefined;
  const updateChannelVideos = input.maxChannelVideosPerRun !== undefined;

  validateTopicCaps(input);

  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const current = await client.sql<{ cadenceDays: number; windowDays: number }>`
      SELECT cadence_days as "cadenceDays", window_days as "windowDays"
      FROM topics
      WHERE id = ${topicId} AND user_id = ${userId}
      FOR UPDATE
    `;
    const stored = current.rows[0];
    if (!stored) {
      await client.sql`ROLLBACK`;
      return null;
    }

    // A partial edit still has to leave a schedule the constraint accepts, and
    // the stored row carries whichever half the caller did not send.
    validateTopicSchedule(
      updateCadence ? input.cadenceDays ?? stored.cadenceDays : stored.cadenceDays,
      updateWindow ? input.windowDays ?? stored.windowDays : stored.windowDays,
    );

    const result = await client.sql<TopicRow>`
    UPDATE topics t
    SET
      name = CASE WHEN ${updateName}::boolean THEN ${input.name ?? null}::text ELSE t.name END,
      slug = CASE WHEN ${updateSlug}::boolean THEN ${input.slug ?? null}::varchar ELSE t.slug END,
      interests = CASE WHEN ${updateInterests}::boolean THEN ${input.interests ?? null}::text ELSE t.interests END,
      is_active = CASE WHEN ${updateIsActive}::boolean THEN ${input.isActive ?? null}::boolean ELSE t.is_active END,
      cadence_days = CASE WHEN ${updateCadence}::boolean THEN ${input.cadenceDays ?? null}::int ELSE t.cadence_days END,
      window_days = CASE WHEN ${updateWindow}::boolean THEN ${input.windowDays ?? null}::int ELSE t.window_days END,
      max_standing_queries = CASE WHEN ${updateStandingQueries}::boolean THEN ${input.maxStandingQueries ?? null}::int ELSE t.max_standing_queries END,
      max_probes_per_run = CASE WHEN ${updateProbes}::boolean THEN ${input.maxProbesPerRun ?? null}::int ELSE t.max_probes_per_run END,
      max_groups_per_run = CASE WHEN ${updateGroups}::boolean THEN ${input.maxGroupsPerRun ?? null}::int ELSE t.max_groups_per_run END,
      max_videos_per_group = CASE WHEN ${updateVideosPerGroup}::boolean THEN ${input.maxVideosPerGroup ?? null}::int ELSE t.max_videos_per_group END,
      max_channel_videos_per_run = CASE WHEN ${updateChannelVideos}::boolean THEN ${input.maxChannelVideosPerRun ?? null}::int ELSE t.max_channel_videos_per_run END,
      updated_at = NOW()
    WHERE t.id = ${topicId} AND t.user_id = ${userId}
    RETURNING
      t.id,
      t.name,
      t.slug,
      t.interests,
      t.is_active as "isActive",
      t.cadence_days as "cadenceDays",
      t.window_days as "windowDays",
      t.max_standing_queries as "maxStandingQueries",
      t.max_probes_per_run as "maxProbesPerRun",
      t.max_groups_per_run as "maxGroupsPerRun",
      t.max_videos_per_group as "maxVideosPerGroup",
      t.max_channel_videos_per_run as "maxChannelVideosPerRun",
      (SELECT COUNT(*)::int FROM topic_channels WHERE topic_id = t.id) as "channelCount",
      (SELECT COUNT(*)::int FROM topic_queries WHERE topic_id = t.id) as "queryCount"
  `;

    await client.sql`COMMIT`;
    return result.rows[0] ? toTopic(result.rows[0]) : null;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lists the channels feeding a Topic the user owns. A Topic that is not theirs
 * reads as an empty one, so the list cannot be used to discover whose it is.
 */
export async function listTopicChannels(userId: string, topicId: string): Promise<TopicChannel[]> {
  const result = await sql<TopicChannelRow>`
    SELECT
      tc.id,
      tc.youtube_channel_id as "youtubeChannelId",
      tc.channel_title as "channelTitle",
      tc.channel_url as "channelUrl",
      tc.added_via as "addedVia"
    FROM topic_channels tc
    JOIN topics t ON t.id = tc.topic_id
    WHERE t.id = ${topicId} AND t.user_id = ${userId}
    ORDER BY tc.created_at ASC, tc.id ASC
  `;
  return result.rows.map(toTopicChannel);
}

/**
 * Reads one channel of a Topic, scoped through the Topic's owner. Used to answer
 * an add that conflicted with a row already on the Topic.
 */
async function getTopicChannel(
  userId: string,
  topicId: string,
  youtubeChannelId: string,
): Promise<TopicChannel | null> {
  const result = await sql<TopicChannelRow>`
    SELECT
      tc.id,
      tc.youtube_channel_id as "youtubeChannelId",
      tc.channel_title as "channelTitle",
      tc.channel_url as "channelUrl",
      tc.added_via as "addedVia"
    FROM topic_channels tc
    JOIN topics t ON t.id = tc.topic_id
    WHERE t.id = ${topicId}
      AND t.user_id = ${userId}
      AND tc.youtube_channel_id = ${youtubeChannelId}
  `;
  return result.rows[0] ? toTopicChannel(result.rows[0]) : null;
}

/**
 * Puts one channel on a Topic the user owns. Adding a channel the Topic already
 * holds is not an error: the stored row comes back untouched, so a double
 * submission reads as the one add it was meant to be. Returns null when the
 * Topic does not exist or is someone else's.
 */
export async function addTopicChannel(
  userId: string,
  topicId: string,
  input: AddTopicChannelInput,
): Promise<TopicChannel | null> {
  const addedVia: TopicChannelSource = input.addedVia ?? "manual";

  const result = await sql<TopicChannelRow>`
    INSERT INTO topic_channels (topic_id, youtube_channel_id, channel_title, channel_url, added_via)
    SELECT
      t.id,
      ${input.youtubeChannelId},
      ${input.channelTitle ?? null},
      ${input.channelUrl ?? null},
      ${addedVia}
    FROM topics t
    WHERE t.id = ${topicId} AND t.user_id = ${userId}
    ON CONFLICT (topic_id, youtube_channel_id) DO NOTHING
    RETURNING
      id,
      youtube_channel_id as "youtubeChannelId",
      channel_title as "channelTitle",
      channel_url as "channelUrl",
      added_via as "addedVia"
  `;

  if (result.rows[0]) {
    await sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId} AND user_id = ${userId}`;
    return toTopicChannel(result.rows[0]);
  }

  // Nothing inserted: either the Topic is not this user's, or it already holds
  // this channel. Only the second case has a row to hand back.
  return getTopicChannel(userId, topicId, input.youtubeChannelId);
}

export async function removeTopicChannel(
  userId: string,
  topicId: string,
  channelId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM topic_channels tc
    USING topics t
    WHERE t.id = tc.topic_id
      AND t.id = ${topicId}
      AND t.user_id = ${userId}
      AND tc.id = ${channelId}
  `;

  if ((result.rowCount ?? 0) > 0) {
    await sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId} AND user_id = ${userId}`;
    return true;
  }
  return false;
}

/**
 * Whether this Topic is this user's. Read without a lock, for the paths that
 * have no row to authorize against on their own.
 */
async function ownsTopic(userId: string, topicId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    SELECT id FROM topics WHERE id = ${topicId} AND user_id = ${userId}
  `;
  return result.rows.length > 0;
}

/**
 * Puts every ticked row of a subscriptions export onto a Topic the user owns, as
 * 'takeout' channels, and returns the rows it actually created. Channels the
 * Topic already holds are skipped rather than treated as a failure, because an
 * import is a set of rows a person ticked and one overlap should not cost them
 * the other 141. Returns null when the Topic does not exist or is someone
 * else's, whether or not there was anything to insert.
 */
export async function addTopicChannelsFromTakeout(
  userId: string,
  topicId: string,
  channels: TakeoutChannelInput[],
): Promise<TopicChannel[] | null> {
  // An export can name the same channel twice, and two rows conflicting inside
  // one statement is not something ON CONFLICT resolves.
  const unique = new Map<string, TakeoutChannelInput>();
  for (const channel of channels) {
    if (!unique.has(channel.youtubeChannelId)) {
      unique.set(channel.youtubeChannelId, channel);
    }
  }

  if (unique.size === 0) {
    return (await ownsTopic(userId, topicId)) ? [] : null;
  }

  const rows = [...unique.values()];
  const values = rows
    .map((_, index) => {
      const base = index * 3 + 3;
      return `($${base}::text, $${base + 1}::text, $${base + 2}::text)`;
    })
    .join(", ");
  const channelParams: (string | null)[] = [];
  for (const channel of rows) {
    channelParams.push(
      channel.youtubeChannelId,
      channel.channelTitle ?? null,
      channel.channelUrl ?? null,
    );
  }

  const result = await sql.query<TopicChannelRow>(
    `
    INSERT INTO topic_channels (topic_id, youtube_channel_id, channel_title, channel_url, added_via)
    SELECT t.id, v.channel_id, v.title, v.url, 'takeout'
    FROM topics t
    CROSS JOIN (VALUES ${values}) AS v(channel_id, title, url)
    WHERE t.id = $2 AND t.user_id = $1
    ON CONFLICT (topic_id, youtube_channel_id) DO NOTHING
    RETURNING
      id,
      youtube_channel_id as "youtubeChannelId",
      channel_title as "channelTitle",
      channel_url as "channelUrl",
      added_via as "addedVia"
    `,
    [userId, topicId, ...channelParams],
  );

  if (result.rows.length === 0) {
    return (await ownsTopic(userId, topicId)) ? [] : null;
  }

  await sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId} AND user_id = ${userId}`;
  return result.rows.map(toTopicChannel);
}

/**
 * Lists the standing queries feeding a Topic the user owns. A Topic that is not
 * theirs reads as an empty one.
 */
export async function listTopicQueries(userId: string, topicId: string): Promise<TopicQuery[]> {
  const result = await sql<TopicQueryRow>`
    SELECT tq.id, tq.query
    FROM topic_queries tq
    JOIN topics t ON t.id = tq.topic_id
    WHERE t.id = ${topicId} AND t.user_id = ${userId}
    ORDER BY tq.created_at ASC, tq.id ASC
  `;
  return result.rows.map(toTopicQuery);
}

/**
 * Adds a standing query to a Topic the user owns, or returns null when the Topic
 * is not theirs. Throws TopicQueryLimitError when the Topic already holds its
 * own maximum, so the caller can say so rather than drop the query quietly.
 *
 * The count and the insert share a transaction with the Topic locked, so two
 * concurrent adds cannot both read room that only one of them has. A query the
 * Topic already holds returns the stored row and never meets the cap: re-adding
 * it is not a new query.
 */
export async function addTopicQuery(
  userId: string,
  topicId: string,
  query: string,
): Promise<TopicQuery | null> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const owned = await client.sql<{ maxStandingQueries: number }>`
      SELECT max_standing_queries as "maxStandingQueries"
      FROM topics
      WHERE id = ${topicId} AND user_id = ${userId}
      FOR UPDATE
    `;
    const topic = owned.rows[0];
    if (!topic) {
      await client.sql`ROLLBACK`;
      return null;
    }

    const existing = await client.sql<TopicQueryRow>`
      SELECT id, query FROM topic_queries
      WHERE topic_id = ${topicId} AND query = ${query}
    `;
    if (existing.rows[0]) {
      await client.sql`COMMIT`;
      return toTopicQuery(existing.rows[0]);
    }

    const counted = await client.sql<{ count: number }>`
      SELECT COUNT(*)::int as count FROM topic_queries WHERE topic_id = ${topicId}
    `;
    if ((counted.rows[0]?.count ?? 0) >= topic.maxStandingQueries) {
      throw new TopicQueryLimitError();
    }

    const inserted = await client.sql<TopicQueryRow>`
      INSERT INTO topic_queries (topic_id, query)
      VALUES (${topicId}, ${query})
      RETURNING id, query
    `;
    await client.sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId}`;
    await client.sql`COMMIT`;
    return toTopicQuery(inserted.rows[0]);
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Rewrites one standing query of a Topic the user owns, keeping the row, and with
 * it the `created_at` that later asks measure a query's usefulness against. Null
 * when the query is not on that Topic and when the Topic is not theirs, which read
 * the same to the caller. Rewriting a query to the text it already carries is the
 * no-op it looks like.
 *
 * Throws DuplicateTopicQueryError when a different query on the same Topic already
 * holds that text. Refusing is the honest answer: merging the two rows would drop
 * one silently, and leaving both would show an edit that did not happen.
 */
export async function updateTopicQuery(
  userId: string,
  topicId: string,
  queryId: string,
  query: string,
): Promise<TopicQuery | null> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;

    const owned = await client.sql<TopicQueryRow>`
      SELECT tq.id, tq.query
      FROM topic_queries tq
      JOIN topics t ON t.id = tq.topic_id
      WHERE tq.id = ${queryId} AND t.id = ${topicId} AND t.user_id = ${userId}
      FOR UPDATE OF tq
    `;
    const stored = owned.rows[0];
    if (!stored) {
      await client.sql`ROLLBACK`;
      return null;
    }
    if (stored.query === query) {
      await client.sql`COMMIT`;
      return toTopicQuery(stored);
    }

    const clash = await client.sql<{ id: string }>`
      SELECT id FROM topic_queries WHERE topic_id = ${topicId} AND query = ${query}
    `;
    if (clash.rows[0]) {
      throw new DuplicateTopicQueryError();
    }

    const updated = await client.sql<TopicQueryRow>`
      UPDATE topic_queries
      SET query = ${query}, updated_at = NOW()
      WHERE id = ${queryId} AND topic_id = ${topicId}
      RETURNING id, query
    `;
    await client.sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId}`;
    await client.sql`COMMIT`;
    return toTopicQuery(updated.rows[0]);
  } catch (error) {
    await client.sql`ROLLBACK`;
    // Two edits racing onto the same text both read room the index gives one of
    // them, so the loser learns it from the violation rather than from the probe.
    if (isUniqueViolation(error)) {
      throw new DuplicateTopicQueryError();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function removeTopicQuery(
  userId: string,
  topicId: string,
  queryId: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM topic_queries tq
    USING topics t
    WHERE t.id = tq.topic_id
      AND t.id = ${topicId}
      AND t.user_id = ${userId}
      AND tq.id = ${queryId}
  `;

  if ((result.rowCount ?? 0) > 0) {
    await sql`UPDATE topics SET updated_at = NOW() WHERE id = ${topicId} AND user_id = ${userId}`;
    return true;
  }
  return false;
}

/**
 * Fetches one Topic the user owns together with its channels and queries. Null
 * for a slug this user has no Topic at, whoever else might.
 */
export async function getTopicWithFeedsBySlug(
  userId: string,
  slug: string,
): Promise<TopicWithFeeds | null> {
  const topic = await getTopicBySlug(userId, slug);
  if (!topic) return null;

  const [channels, queries] = await Promise.all([
    listTopicChannels(userId, topic.id),
    listTopicQueries(userId, topic.id),
  ]);
  return { ...topic, channels, queries };
}

/**
 * Deletes a Topic the user owns, and with it every channel and query pointing at
 * it through ON DELETE CASCADE. False when the Topic does not exist and when it
 * is someone else's, which read the same to the caller.
 */
export async function deleteTopic(userId: string, topicId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM topics WHERE id = ${topicId} AND user_id = ${userId}
  `;
  return (result.rowCount ?? 0) > 0;
}
