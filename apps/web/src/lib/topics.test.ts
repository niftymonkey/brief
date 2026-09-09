import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@vercel/postgres";
import {
  DuplicateTopicQueryError,
  InvalidTopicCapError,
  InvalidTopicScheduleError,
  TopicQueryLimitError,
  type CreateTopicInput,
  type Topic,
  addTopicChannel,
  addTopicChannelsFromTakeout,
  addTopicQuery,
  chooseTopicSlug,
  createTopic,
  deleteTopic,
  getTopicBySlug,
  getTopicWithFeedsBySlug,
  listTopicChannels,
  listTopicQueries,
  listTopics,
  removeTopicChannel,
  removeTopicQuery,
  updateTopic,
  updateTopicQuery,
} from "./topics";

describe("chooseTopicSlug", () => {
  const never = async () => false;

  it("derives a readable slug from the topic name", async () => {
    expect(await chooseTopicSlug("Rust Async Runtimes", never)).toBe("rust-async-runtimes");
  });

  it("collapses runs of non-alphanumerics and trims the edges", async () => {
    expect(await chooseTopicSlug("  ...C++ / Game  Dev!!  ", never)).toBe("c-game-dev");
  });

  it("appends an incrementing numeric suffix on collision", async () => {
    const taken = new Set(["rust", "rust-2", "rust-3"]);
    const seen: string[] = [];
    const slug = await chooseTopicSlug("Rust", async (candidate) => {
      seen.push(candidate);
      return taken.has(candidate);
    });

    expect(slug).toBe("rust-4");
    expect(seen).toEqual(["rust", "rust-2", "rust-3", "rust-4"]);
  });

  it("still yields a usable slug for a name with no alphanumerics", async () => {
    expect(await chooseTopicSlug("！！！", never)).toBe("topic");
    expect(await chooseTopicSlug("???", never)).toBe("topic");
    expect(await chooseTopicSlug("", never)).toBe("topic");
  });

  it("caps the slug length without leaving a trailing hyphen", async () => {
    const slug = await chooseTopicSlug(`${"a".repeat(59)} bcdefg`, never);
    expect(slug).toBe("a".repeat(59));
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe("topics db lifecycle", () => {
  // Random rather than time-based, so two overlapping runs of this file cannot
  // land on the same ids and fight over one user's topic slugs. The
  // `vitest-topics-` prefixes are load-bearing: the cleanup sweep and a manual
  // hunt for leftover rows both find this suite's users by them.
  const runToken = randomUUID().slice(0, 8);
  const userId = `vitest-topics-${runToken}`;
  const strangerId = `vitest-topics-stranger-${runToken}`;
  const cleanupTopicIds: string[] = [];

  function requireDb(): void {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for topics db integration tests");
    }
  }

  async function seedTopic(input: CreateTopicInput): Promise<Topic> {
    requireDb();
    const topic = await createTopic(userId, input);
    cleanupTopicIds.push(topic.id);
    return topic;
  }

  async function queryTimestamps(queryId: string): Promise<{ createdAt: Date; updatedAt: Date }> {
    const result = await sql<{ createdAt: Date; updatedAt: Date }>`
      SELECT created_at as "createdAt", updated_at as "updatedAt"
      FROM topic_queries WHERE id = ${queryId}
    `;
    const row = result.rows[0];
    if (!row) throw new Error("Expected the query row to still be there");
    return row;
  }

  afterAll(async () => {
    for (const id of cleanupTopicIds) {
      await sql`DELETE FROM topics WHERE id = ${id}`;
    }
  });

  it("creates a topic with the schema's defaults and no feeds", async () => {
    const topic = await seedTopic({ name: "Rust Async Runtimes" });

    expect(topic).toMatchObject({
      name: "Rust Async Runtimes",
      slug: "rust-async-runtimes",
      interests: null,
      isActive: true,
      cadenceDays: 3,
      windowDays: 7,
      maxStandingQueries: 10,
      maxProbesPerRun: 5,
      maxGroupsPerRun: 4,
      maxVideosPerGroup: 3,
      maxChannelVideosPerRun: 10,
      channelCount: 0,
      queryCount: 0,
    });
  });

  it("applies the caller's cadence, window, interests, and cap overrides", async () => {
    const topic = await seedTopic({
      name: "Distributed Systems",
      interests: "consensus, storage engines",
      cadenceDays: 7,
      windowDays: 14,
      maxStandingQueries: 2,
      maxProbesPerRun: 0,
      maxGroupsPerRun: 6,
      maxVideosPerGroup: 1,
      maxChannelVideosPerRun: 20,
    });

    expect(topic).toMatchObject({
      interests: "consensus, storage engines",
      cadenceDays: 7,
      windowDays: 14,
      maxStandingQueries: 2,
      maxProbesPerRun: 0,
      maxGroupsPerRun: 6,
      maxVideosPerGroup: 1,
      maxChannelVideosPerRun: 20,
    });
  });

  it("lists a user's own topics, most recently touched first", async () => {
    const listUserId = `${userId}-list`;
    const older = await createTopic(listUserId, { name: "Older Topic" });
    cleanupTopicIds.push(older.id);
    const newer = await createTopic(listUserId, { name: "Newer Topic" });
    cleanupTopicIds.push(newer.id);

    const listed = await listTopics(listUserId);
    expect(listed.map((topic) => topic.id)).toEqual([newer.id, older.id]);
    expect(await listTopics(strangerId)).toEqual([]);
  });

  it("fetches a topic by slug for its owner and hides it from everyone else", async () => {
    const topic = await seedTopic({ name: "Compilers" });

    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({
      id: topic.id,
      name: "Compilers",
      slug: "compilers",
    });
    expect(await getTopicBySlug(strangerId, topic.slug)).toBeNull();
    expect(await getTopicBySlug(userId, "no-such-topic")).toBeNull();
  });

  it("suffixes the slug when a second topic of the same name is created", async () => {
    const slugUserId = `${userId}-slug`;
    const first = await createTopic(slugUserId, { name: "Rust" });
    cleanupTopicIds.push(first.id);
    const second = await createTopic(slugUserId, { name: "Rust" });
    cleanupTopicIds.push(second.id);
    const third = await createTopic(slugUserId, { name: "Rust" });
    cleanupTopicIds.push(third.id);

    expect([first.slug, second.slug, third.slug]).toEqual(["rust", "rust-2", "rust-3"]);
  });

  it("gives two different users the same slug for the same topic name", async () => {
    const mine = await seedTopic({ name: "Kubernetes" });
    const theirs = await createTopic(strangerId, { name: "Kubernetes" });
    cleanupTopicIds.push(theirs.id);

    expect(mine.slug).toBe("kubernetes");
    expect(theirs.slug).toBe("kubernetes");
  });

  it("keeps the slug stable when the topic is renamed", async () => {
    const topic = await seedTopic({ name: "Web Assembly" });
    expect(topic.slug).toBe("web-assembly");

    const renamed = await updateTopic(userId, topic.id, { name: "WASM Runtimes" });
    expect(renamed).toMatchObject({ name: "WASM Runtimes", slug: "web-assembly" });

    // The link a person saved still resolves, and the name they now read is theirs.
    expect(await getTopicBySlug(userId, "web-assembly")).toMatchObject({
      name: "WASM Runtimes",
    });
    expect(await getTopicBySlug(userId, "wasm-runtimes")).toBeNull();
  });

  it("leaves the slug alone through every edit updateTopic accepts", async () => {
    const topic = await seedTopic({ name: "Observability" });
    expect(topic.slug).toBe("observability");

    await updateTopic(userId, topic.id, { name: "OpenTelemetry", interests: "traces" });
    const edited = await updateTopic(userId, topic.id, { isActive: false, cadenceDays: 2 });

    // The slug is minted at creation and never written again, so no edit can
    // break a link a person saved, and none can collide on idx_topics_user_slug.
    expect(edited).toMatchObject({ name: "OpenTelemetry", slug: "observability" });
    expect(await getTopicBySlug(userId, "observability")).toMatchObject({ id: topic.id });
    expect(await getTopicBySlug(userId, "opentelemetry")).toBeNull();
  });

  it("retains unmodified topic fields on a partial update", async () => {
    const topic = await seedTopic({
      name: "Type Theory",
      interests: "dependent types",
      cadenceDays: 4,
      windowDays: 9,
    });

    const paused = await updateTopic(userId, topic.id, { isActive: false });
    expect(paused).toMatchObject({
      name: "Type Theory",
      interests: "dependent types",
      isActive: false,
      cadenceDays: 4,
      windowDays: 9,
    });

    const recadenced = await updateTopic(userId, topic.id, { cadenceDays: 2 });
    expect(recadenced).toMatchObject({
      interests: "dependent types",
      isActive: false,
      cadenceDays: 2,
      windowDays: 9,
    });

    const cleared = await updateTopic(userId, topic.id, { interests: null });
    expect(cleared).toMatchObject({ interests: null, cadenceDays: 2, windowDays: 9 });

    const capped = await updateTopic(userId, topic.id, {
      maxStandingQueries: 1,
      maxProbesPerRun: 2,
      maxGroupsPerRun: 3,
      maxVideosPerGroup: 4,
      maxChannelVideosPerRun: 5,
    });
    expect(capped).toMatchObject({
      maxStandingQueries: 1,
      maxProbesPerRun: 2,
      maxGroupsPerRun: 3,
      maxVideosPerGroup: 4,
      maxChannelVideosPerRun: 5,
      cadenceDays: 2,
      windowDays: 9,
    });
  });

  it("refuses an update from someone who does not own the topic", async () => {
    const topic = await seedTopic({ name: "Private Reading" });

    expect(await updateTopic(strangerId, topic.id, { name: "Hijacked" })).toBeNull();
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ name: "Private Reading" });
  });

  it("refuses a window narrower than the cadence, and creates nothing", async () => {
    requireDb();

    const rejection = await createTopic(userId, {
      name: "Gappy Schedule",
      cadenceDays: 10,
      windowDays: 7,
    }).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(InvalidTopicScheduleError);
    // The caller reads a sentence, not a constraint name from Postgres.
    expect(String(rejection)).not.toContain("topics_window_days_check");

    await expect(
      createTopic(userId, { name: "Gappy Schedule", cadenceDays: 0 }),
    ).rejects.toBeInstanceOf(InvalidTopicScheduleError);

    expect(await getTopicBySlug(userId, "gappy-schedule")).toBeNull();
  });

  it("refuses a partial update whose merged schedule would leave a gap", async () => {
    const topic = await seedTopic({ name: "Merged Schedule", cadenceDays: 3, windowDays: 7 });

    // Only the cadence is sent, so the stored window of 7 is what makes 10 unwritable.
    await expect(
      updateTopic(userId, topic.id, { cadenceDays: 10 }),
    ).rejects.toBeInstanceOf(InvalidTopicScheduleError);
    await expect(
      updateTopic(userId, topic.id, { windowDays: 2 }),
    ).rejects.toBeInstanceOf(InvalidTopicScheduleError);

    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({
      cadenceDays: 3,
      windowDays: 7,
    });

    // Both bounds moving together is fine, since the pair is what has to hold.
    expect(await updateTopic(userId, topic.id, { cadenceDays: 10, windowDays: 21 })).toMatchObject({
      cadenceDays: 10,
      windowDays: 21,
    });
  });

  it("refuses a cap below the floor its column enforces", async () => {
    const topic = await seedTopic({ name: "Floored Caps" });

    await expect(
      createTopic(userId, { name: "No Groups", maxGroupsPerRun: 0 }),
    ).rejects.toBeInstanceOf(InvalidTopicCapError);
    await expect(
      updateTopic(userId, topic.id, { maxStandingQueries: -1 }),
    ).rejects.toBeInstanceOf(InvalidTopicCapError);

    expect(await getTopicBySlug(userId, "no-groups")).toBeNull();
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ maxStandingQueries: 10 });
  });

  it("mirrors a schedule rule the database itself enforces", async () => {
    requireDb();

    await expect(
      sql`
        INSERT INTO topics (user_id, name, slug, cadence_days, window_days)
        VALUES (${userId}, 'Raw Gap', 'raw-gap', 10, 7)
      `,
    ).rejects.toThrow(/topics_window_days_check/);
  });

  it("adds, lists, and removes a topic's channels", async () => {
    const topic = await seedTopic({ name: "Channel Feeds" });

    const added = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCchannelone",
      channelTitle: "Channel One",
      channelUrl: "https://www.youtube.com/channel/UCchannelone",
    });
    expect(added).toMatchObject({
      youtubeChannelId: "UCchannelone",
      channelTitle: "Channel One",
      channelUrl: "https://www.youtube.com/channel/UCchannelone",
      addedVia: "manual",
    });

    const suggested = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCchanneltwo",
      addedVia: "suggested",
    });
    expect(suggested).toMatchObject({
      youtubeChannelId: "UCchanneltwo",
      channelTitle: null,
      channelUrl: null,
      addedVia: "suggested",
    });

    const listed = await listTopicChannels(userId, topic.id);
    expect(listed.map((channel) => channel.youtubeChannelId)).toEqual([
      "UCchannelone",
      "UCchanneltwo",
    ]);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ channelCount: 2 });

    if (!added) throw new Error("Expected the channel to have been added");
    expect(await removeTopicChannel(userId, topic.id, added.id)).toBe(true);
    expect(await removeTopicChannel(userId, topic.id, added.id)).toBe(false);
    expect((await listTopicChannels(userId, topic.id)).length).toBe(1);
  });

  it("returns the existing row when the same channel is added twice", async () => {
    const topic = await seedTopic({ name: "Repeat Channel" });

    const first = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCrepeatxxxx",
      channelTitle: "First Title",
    });
    const second = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCrepeatxxxx",
      channelTitle: "Second Title",
    });

    expect(second?.id).toBe(first?.id);
    expect(second?.channelTitle).toBe("First Title");
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ channelCount: 1 });
  });

  it("keeps a topic's channels invisible and untouchable to another user", async () => {
    const topic = await seedTopic({ name: "Guarded Channels" });
    const channel = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCguardedxxx",
    });
    if (!channel) throw new Error("Expected the channel to have been added");

    expect(await addTopicChannel(strangerId, topic.id, { youtubeChannelId: "UCintruderxx" })).toBeNull();
    expect(await listTopicChannels(strangerId, topic.id)).toEqual([]);
    expect(await removeTopicChannel(strangerId, topic.id, channel.id)).toBe(false);

    expect((await listTopicChannels(userId, topic.id)).map((c) => c.youtubeChannelId)).toEqual([
      "UCguardedxxx",
    ]);
  });

  it("refuses to remove a channel through a topic that does not hold it", async () => {
    const holder = await seedTopic({ name: "Holding Topic" });
    const other = await seedTopic({ name: "Other Topic" });

    const channel = await addTopicChannel(userId, holder.id, {
      youtubeChannelId: "UCcrosstopic",
    });
    if (!channel) throw new Error("Expected the channel to have been added");

    expect(await removeTopicChannel(userId, other.id, channel.id)).toBe(false);
    expect((await listTopicChannels(userId, holder.id)).length).toBe(1);
  });

  it("bulk inserts the ticked rows of a subscriptions export as takeout channels", async () => {
    const topic = await seedTopic({ name: "Takeout Import" });

    const inserted = await addTopicChannelsFromTakeout(userId, topic.id, [
      {
        youtubeChannelId: "UCtakeoutone",
        channelTitle: "Takeout One",
        channelUrl: "https://www.youtube.com/channel/UCtakeoutone",
      },
      { youtubeChannelId: "UCtakeouttwo", channelTitle: "Takeout Two" },
    ]);

    expect(inserted?.map((channel) => channel.youtubeChannelId).sort()).toEqual([
      "UCtakeoutone",
      "UCtakeouttwo",
    ]);
    expect(inserted?.every((channel) => channel.addedVia === "takeout")).toBe(true);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ channelCount: 2 });
  });

  it("skips channels the topic already holds instead of failing the whole import", async () => {
    const topic = await seedTopic({ name: "Partial Import" });

    const existing = await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCalreadyxxx",
      channelTitle: "Added By Hand",
    });

    const inserted = await addTopicChannelsFromTakeout(userId, topic.id, [
      { youtubeChannelId: "UCalreadyxxx", channelTitle: "From Takeout" },
      { youtubeChannelId: "UCfreshxxxxx", channelTitle: "Fresh" },
      // A duplicate inside one submission counts once, not twice.
      { youtubeChannelId: "UCfreshxxxxx", channelTitle: "Fresh Again" },
    ]);

    expect(inserted?.map((channel) => channel.youtubeChannelId)).toEqual(["UCfreshxxxxx"]);

    const all = await listTopicChannels(userId, topic.id);
    expect(all.length).toBe(2);
    expect(all.find((channel) => channel.id === existing?.id)).toMatchObject({
      channelTitle: "Added By Hand",
      addedVia: "manual",
    });
  });

  it("imports nothing for a user who does not own the topic", async () => {
    const topic = await seedTopic({ name: "Guarded Import" });

    expect(
      await addTopicChannelsFromTakeout(strangerId, topic.id, [
        { youtubeChannelId: "UCintruderxx" },
      ]),
    ).toBeNull();
    expect(await addTopicChannelsFromTakeout(strangerId, topic.id, [])).toBeNull();
    expect(await addTopicChannelsFromTakeout(userId, topic.id, [])).toEqual([]);
    expect(await listTopicChannels(userId, topic.id)).toEqual([]);
  });

  it("adds, lists, and removes a topic's standing queries", async () => {
    const topic = await seedTopic({ name: "Standing Queries" });

    const first = await addTopicQuery(userId, topic.id, "rust async runtime");
    const second = await addTopicQuery(userId, topic.id, "tokio internals");
    expect(first).toMatchObject({ query: "rust async runtime" });
    expect(second).toMatchObject({ query: "tokio internals" });

    expect((await listTopicQueries(userId, topic.id)).map((q) => q.query)).toEqual([
      "rust async runtime",
      "tokio internals",
    ]);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ queryCount: 2 });

    if (!first) throw new Error("Expected the query to have been added");
    expect(await removeTopicQuery(userId, topic.id, first.id)).toBe(true);
    expect(await removeTopicQuery(userId, topic.id, first.id)).toBe(false);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ queryCount: 1 });
  });

  it("refuses a query once the topic sits at its own max_standing_queries", async () => {
    const topic = await seedTopic({ name: "Capped Queries", maxStandingQueries: 2 });

    await addTopicQuery(userId, topic.id, "first query");
    await addTopicQuery(userId, topic.id, "second query");

    const rejection = await addTopicQuery(userId, topic.id, "third query").catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(TopicQueryLimitError);
    expect((await listTopicQueries(userId, topic.id)).length).toBe(2);

    // Re-adding one the topic already holds is not a new query, so the cap has
    // nothing to refuse.
    expect(await addTopicQuery(userId, topic.id, "first query")).toMatchObject({
      query: "first query",
    });
    expect((await listTopicQueries(userId, topic.id)).length).toBe(2);

    // Raising the cap is what makes room, and the refusal was not a dead end.
    await updateTopic(userId, topic.id, { maxStandingQueries: 3 });
    expect(await addTopicQuery(userId, topic.id, "third query")).toMatchObject({
      query: "third query",
    });
  });

  it("refuses every query on a topic whose cap is zero", async () => {
    const topic = await seedTopic({ name: "No Queries", maxStandingQueries: 0 });

    await expect(addTopicQuery(userId, topic.id, "any query")).rejects.toBeInstanceOf(
      TopicQueryLimitError,
    );
    expect(await listTopicQueries(userId, topic.id)).toEqual([]);
  });

  it("keeps a topic's queries invisible and untouchable to another user", async () => {
    const topic = await seedTopic({ name: "Guarded Queries" });
    const query = await addTopicQuery(userId, topic.id, "owner only");
    if (!query) throw new Error("Expected the query to have been added");

    expect(await addTopicQuery(strangerId, topic.id, "intruder query")).toBeNull();
    expect(await listTopicQueries(strangerId, topic.id)).toEqual([]);
    expect(await removeTopicQuery(strangerId, topic.id, query.id)).toBe(false);

    expect((await listTopicQueries(userId, topic.id)).map((q) => q.query)).toEqual(["owner only"]);
  });

  it("edits a standing query in place, keeping the row it was", async () => {
    const topic = await seedTopic({ name: "Edited Queries" });
    const first = await addTopicQuery(userId, topic.id, "rust asycn runtime");
    const second = await addTopicQuery(userId, topic.id, "tokio internals");
    if (!first || !second) throw new Error("Expected both queries to have been added");

    const before = await queryTimestamps(first.id);
    const edited = await updateTopicQuery(userId, topic.id, first.id, "rust async runtime");

    expect(edited).toEqual({ id: first.id, query: "rust async runtime" });
    const after = await queryTimestamps(first.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt >= before.updatedAt).toBe(true);

    // The list orders by created_at, so a preserved timestamp is also a preserved place.
    expect((await listTopicQueries(userId, topic.id)).map((q) => q.query)).toEqual([
      "rust async runtime",
      "tokio internals",
    ]);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ queryCount: 2 });
  });

  it("refuses an edit onto a search the topic already holds, and changes nothing", async () => {
    const topic = await seedTopic({ name: "Clashing Queries" });
    const first = await addTopicQuery(userId, topic.id, "rust async runtime");
    const second = await addTopicQuery(userId, topic.id, "tokio internals");
    if (!first || !second) throw new Error("Expected both queries to have been added");

    const rejection = await updateTopicQuery(
      userId,
      topic.id,
      second.id,
      "rust async runtime",
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(DuplicateTopicQueryError);
    expect((await listTopicQueries(userId, topic.id)).map((q) => q.query)).toEqual([
      "rust async runtime",
      "tokio internals",
    ]);
  });

  it("treats an edit to the text a query already carries as the no-op it is", async () => {
    const topic = await seedTopic({ name: "Unchanged Queries" });
    const query = await addTopicQuery(userId, topic.id, "wgpu compute");
    if (!query) throw new Error("Expected the query to have been added");

    const before = await queryTimestamps(query.id);
    expect(await updateTopicQuery(userId, topic.id, query.id, "wgpu compute")).toEqual({
      id: query.id,
      query: "wgpu compute",
    });
    expect((await queryTimestamps(query.id)).createdAt).toEqual(before.createdAt);
  });

  it("leaves a query another user owns, or one on another topic, unedited", async () => {
    const topic = await seedTopic({ name: "Guarded Query Edits" });
    const other = await seedTopic({ name: "Other Query Home" });
    const query = await addTopicQuery(userId, topic.id, "owner only");
    if (!query) throw new Error("Expected the query to have been added");

    expect(await updateTopicQuery(strangerId, topic.id, query.id, "intruder edit")).toBeNull();
    expect(await updateTopicQuery(userId, other.id, query.id, "wrong topic edit")).toBeNull();
    expect(
      await updateTopicQuery(
        userId,
        topic.id,
        "00000000-0000-0000-0000-000000000000",
        "no such query",
      ),
    ).toBeNull();

    expect((await listTopicQueries(userId, topic.id)).map((q) => q.query)).toEqual(["owner only"]);
  });

  it("fetches a topic with its channels and queries in one read", async () => {
    const topic = await seedTopic({ name: "Full Topic", interests: "everything" });
    await addTopicChannel(userId, topic.id, {
      youtubeChannelId: "UCfullonexxx",
      channelTitle: "Full One",
    });
    await addTopicChannel(userId, topic.id, { youtubeChannelId: "UCfulltwoxxx" });
    await addTopicQuery(userId, topic.id, "full query one");
    await addTopicQuery(userId, topic.id, "full query two");

    const full = await getTopicWithFeedsBySlug(userId, topic.slug);
    expect(full).toMatchObject({
      id: topic.id,
      name: "Full Topic",
      interests: "everything",
      channelCount: 2,
      queryCount: 2,
    });
    expect(full?.channels.map((channel) => channel.youtubeChannelId)).toEqual([
      "UCfullonexxx",
      "UCfulltwoxxx",
    ]);
    expect(full?.queries.map((query) => query.query)).toEqual([
      "full query one",
      "full query two",
    ]);

    expect(await getTopicWithFeedsBySlug(strangerId, topic.slug)).toBeNull();
    expect(await getTopicWithFeedsBySlug(userId, "no-such-topic")).toBeNull();
  });

  it("deletes a topic and takes its channels and queries with it", async () => {
    const topic = await seedTopic({ name: "Doomed Topic" });
    await addTopicChannel(userId, topic.id, { youtubeChannelId: "UCdoomedxxxx" });
    await addTopicQuery(userId, topic.id, "doomed query");

    expect(await deleteTopic(userId, topic.id)).toBe(true);
    cleanupTopicIds.splice(cleanupTopicIds.indexOf(topic.id), 1);

    const orphanChannels = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM topic_channels WHERE topic_id = ${topic.id}
    `;
    const orphanQueries = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM topic_queries WHERE topic_id = ${topic.id}
    `;
    expect(orphanChannels.rows[0].count).toBe("0");
    expect(orphanQueries.rows[0].count).toBe("0");

    expect(await getTopicBySlug(userId, topic.slug)).toBeNull();
    expect(await deleteTopic(userId, topic.id)).toBe(false);
  });

  it("refuses a delete from someone who does not own the topic", async () => {
    const topic = await seedTopic({ name: "Guarded Topic" });

    expect(await deleteTopic(strangerId, topic.id)).toBe(false);
    expect(await getTopicBySlug(userId, topic.slug)).toMatchObject({ id: topic.id });
  });

  it("tells a stranger nothing about a capped topic beyond its being unreachable", async () => {
    const topic = await seedTopic({ name: "Capped And Guarded", maxStandingQueries: 0 });

    // The cap is the owner's business: a stranger gets the same null they would
    // get for a topic that does not exist, never a limit error that confirms one
    // does.
    expect(await addTopicQuery(strangerId, topic.id, "probing query")).toBeNull();
  });
});
