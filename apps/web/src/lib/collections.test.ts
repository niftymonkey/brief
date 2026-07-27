import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "@vercel/postgres";
import {
  type CollectionItem,
  type ResolvedVideoFacts,
  type VideoFactsResolver,
  InvalidClipRangeError,
  addCollectionItem,
  chooseCollectionSlug,
  createCollection,
  deleteCollection,
  deleteCollectionItem,
  getCollection,
  getCollectionItem,
  getCollectionWithItems,
  getSharedCollectionBySlug,
  listCollections,
  midpointPosition,
  resolveCollectionVideoFacts,
  setCollectionShared,
  updateCollection,
  updateCollectionItem,
  writeGeneratedSummary,
} from "./collections";

function expectCollectionItem(item: CollectionItem | null): CollectionItem {
  if (!item) throw new Error("Expected collection item to exist");
  return item;
}

/**
 * Facts resolver for the db tests that are not about video facts. Passing it
 * keeps the suite off the YouTube API. Resolution itself is exercised in the
 * "collection item video facts" block below, which injects its own resolvers.
 */
const noFacts: VideoFactsResolver = async () => ({ title: null, durationSec: null });

describe("midpointPosition", () => {
  it("uses an append-style first position with no neighbors", () => {
    expect(midpointPosition(null, null)).toBe(1);
  });

  it("computes a server-side fractional midpoint between neighbors", () => {
    expect(midpointPosition(1, 2)).toBe(1.5);
  });

  it("places before the first neighbor when only before is supplied", () => {
    expect(midpointPosition(null, 10)).toBe(9);
  });

  it("places after the last neighbor when only after is supplied", () => {
    expect(midpointPosition(10, null)).toBe(11);
  });
});

describe("chooseCollectionSlug", () => {
  it("uses the normalized title when it is available", async () => {
    const slug = await chooseCollectionSlug("My Favorite Shorts", async () => false, () => "a1b2");
    expect(slug).toBe("my-favorite-shorts");
  });

  it("adds a short random suffix when the base slug collides", async () => {
    const seen: string[] = [];
    const slug = await chooseCollectionSlug(
      "Favorites",
      async (candidate) => {
        seen.push(candidate);
        return candidate === "favorites";
      },
      () => "a1b2",
    );

    expect(slug).toBe("favorites-a1b2");
    expect(seen).toEqual(["favorites", "favorites-a1b2"]);
  });
});

describe("collections db lifecycle", () => {
  const userId = `vitest-collections-${Date.now()}`;
  const cleanupCollectionIds: string[] = [];

  afterAll(async () => {
    for (const id of cleanupCollectionIds) {
      await sql`DELETE FROM collections WHERE id = ${id}`;
    }
  });

  it("creates, lists, updates, reorders, swaps, shares, and deletes collections", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, {
      title: "Favorites",
      description: "Initial notes",
    });
    cleanupCollectionIds.push(collection.id);

    expect(collection).toMatchObject({
      title: "Favorites",
      description: "Initial notes",
      isShared: false,
      slug: null,
      itemCount: 0,
    });

    const first = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "aaaaaaaaaaa",
      startSec: 10,
      endSec: 20,
      summary: "First summary",
    }, noFacts));
    const second = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "bbbbbbbbbbb",
    }, noFacts));
    const third = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "ccccccccccc",
    }, noFacts));

    expect([first.position, second.position, third.position]).toEqual([1, 2, 3]);
    expect(first.summaryStatus).toBe("ready");

    const collections = await listCollections(userId);
    expect(collections).toEqual([
      expect.objectContaining({ id: collection.id, itemCount: 3 }),
    ]);

    const listed = await getCollectionWithItems(userId, collection.id);
    expect(listed?.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);

    const reordered = await updateCollectionItem(userId, collection.id, third.id, {
      afterItemId: first.id,
      beforeItemId: second.id,
    });
    expect(reordered?.position).toBe(1.5);

    const swapped = await updateCollectionItem(userId, collection.id, third.id, {
      videoId: "ddddddddddd",
      startSec: 30,
      endSec: null,
    }, noFacts);
    expect(swapped).toMatchObject({
      videoId: "ddddddddddd",
      startSec: 30,
      endSec: null,
      summary: null,
      summaryStatus: "pending",
      position: 1.5,
    });

    const summarized = await updateCollectionItem(userId, collection.id, second.id, {
      summary: "Updated second summary",
    });
    expect(summarized?.summaryStatus).toBe("ready");

    const updated = await updateCollection(userId, collection.id, {
      title: "Favorites renamed",
      description: null,
    });
    expect(updated).toMatchObject({
      title: "Favorites renamed",
      description: null,
      itemCount: 3,
    });

    const shared = await setCollectionShared(userId, collection.id, true);
    expect(shared?.isShared).toBe(true);
    expect(shared?.slug).toBe("favorites-renamed");

    const sharedCollection = await getSharedCollectionBySlug("favorites-renamed");
    expect(sharedCollection?.id).toBe(collection.id);
    expect(sharedCollection?.items.map((item) => item.id)).toEqual([first.id, third.id, second.id]);

    const colliding = await createCollection(userId, { title: "Favorites renamed" });
    cleanupCollectionIds.push(colliding.id);
    const collidingShare = await setCollectionShared(userId, colliding.id, true, () => "a1b2");
    expect(collidingShare?.slug).toBe("favorites-renamed-a1b2");

    expect(await deleteCollectionItem(userId, collection.id, first.id)).toBe(true);
    expect(await getCollectionWithItems(userId, collection.id)).toMatchObject({ itemCount: 2 });

    expect(await deleteCollection(userId, collection.id)).toBe(true);
    cleanupCollectionIds.splice(cleanupCollectionIds.indexOf(collection.id), 1);

    const orphanCount = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM collection_items WHERE collection_id = ${collection.id}
    `;
    expect(orphanCount.rows[0].count).toBe("0");
    expect(await getCollectionWithItems(userId, collection.id)).toBeNull();
  });

  it("retains unmodified item fields on a partial update", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Partial item update" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "eeeeeeeeeee",
      startSec: 5,
      endSec: 15,
      summary: "keep me",
    }, noFacts));
    expect([item.startSec, item.endSec]).toEqual([5, 15]);

    const summaryEdited = expectCollectionItem(
      await updateCollectionItem(userId, collection.id, item.id, { summary: "new summary" }),
    );
    expect(summaryEdited).toMatchObject({
      startSec: 5,
      endSec: 15,
      summary: "new summary",
      summaryStatus: "ready",
    });

    const startEdited = expectCollectionItem(
      await updateCollectionItem(userId, collection.id, item.id, { startSec: 10 }),
    );
    expect(startEdited).toMatchObject({
      startSec: 10,
      endSec: 15,
      summary: null,
      summaryStatus: "pending",
    });
  });

  it("rejects a partial update that would leave startSec after the existing endSec", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Invalid partial range" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "iiiiiiiiiii",
      startSec: 5,
      endSec: 15,
    }, noFacts));

    await expect(
      updateCollectionItem(userId, collection.id, item.id, { startSec: 42 }),
    ).rejects.toThrow(InvalidClipRangeError);

    const unchanged = await getCollectionWithItems(userId, collection.id);
    expect(unchanged?.items.find((i) => i.id === item.id)).toMatchObject({
      startSec: 5,
      endSec: 15,
    });
  });

  it("rejects adding an item with startSec after endSec and creates no row", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Invalid add range" });
    cleanupCollectionIds.push(collection.id);

    await expect(
      addCollectionItem(userId, collection.id, {
        videoId: "jjjjjjjjjjj",
        startSec: 20,
        endSec: 10,
      }, noFacts),
    ).rejects.toThrow(InvalidClipRangeError);

    const afterRejectedAdd = await getCollectionWithItems(userId, collection.id);
    expect(afterRejectedAdd?.items).toEqual([]);
  });

  it("retains unmodified collection fields on a partial update", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, {
      title: "Original title",
      description: "Original description",
    });
    cleanupCollectionIds.push(collection.id);

    const titleUpdated = await updateCollection(userId, collection.id, { title: "New title" });
    expect(titleUpdated).toMatchObject({ title: "New title", description: "Original description" });

    const descUpdated = await updateCollection(userId, collection.id, { description: "New description" });
    expect(descUpdated).toMatchObject({ title: "New title", description: "New description" });

    const cleared = await updateCollection(userId, collection.id, { description: null });
    expect(cleared).toMatchObject({ title: "New title", description: null });
  });

  it("treats an explicit null summary on add as pending", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Add null summary" });
    cleanupCollectionIds.push(collection.id);

    const withNull = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "fffffffffff",
      summary: null,
    }, noFacts));
    expect(withNull).toMatchObject({ summary: null, summaryStatus: "pending" });

    const withText = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "ggggggggggg",
      summary: "has text",
    }, noFacts));
    expect(withText).toMatchObject({ summary: "has text", summaryStatus: "ready" });
  });

  it("clears the summary and returns to pending when updated to explicit null", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Update summary to null" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "hhhhhhhhhhh",
      summary: "initial summary",
    }, noFacts));
    expect(item.summaryStatus).toBe("ready");

    const cleared = expectCollectionItem(
      await updateCollectionItem(userId, collection.id, item.id, { summary: null }),
    );
    expect(cleared).toMatchObject({ summary: null, summaryStatus: "pending" });

    const retext = expectCollectionItem(
      await updateCollectionItem(userId, collection.id, item.id, { summary: "back to text" }),
    );
    expect(retext).toMatchObject({ summary: "back to text", summaryStatus: "ready" });
  });

  it("breaks position ties deterministically by id", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Tie-break ordering" });
    cleanupCollectionIds.push(collection.id);

    const tiedRows = await sql<{ id: string }>`
      INSERT INTO collection_items (collection_id, video_id, position)
      VALUES
        (${collection.id}, 'tiedvideoaa', 1),
        (${collection.id}, 'tiedvideobb', 1)
      RETURNING id
    `;
    const expectedIds = tiedRows.rows.map((row) => row.id).sort();

    const listed = await getCollectionWithItems(userId, collection.id);
    expect(listed?.items.map((item) => item.id)).toEqual(expectedIds);
  });

  it("writeGeneratedSummary advances a pending item to ready with the generated text", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Generate pending" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "genpendingx",
      startSec: 5,
      endSec: 20,
    }, noFacts));
    expect(item.summaryStatus).toBe("pending");

    const generated = expectCollectionItem(
      await writeGeneratedSummary(userId, collection.id, item.id, {
        status: "ready",
        summary: "auto generated summary",
      }),
    );
    expect(generated).toMatchObject({
      summary: "auto generated summary",
      summaryStatus: "ready",
    });
  });

  it("writeGeneratedSummary never overwrites a ready (hand-edited) summary", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Protect ready" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "genreadyxxx",
      summary: "hand written summary",
    }, noFacts));
    expect(item.summaryStatus).toBe("ready");

    // Generation completing late must not clobber the author's edit.
    const afterGen = expectCollectionItem(
      await writeGeneratedSummary(userId, collection.id, item.id, {
        status: "ready",
        summary: "machine summary that should be ignored",
      }),
    );
    expect(afterGen).toMatchObject({
      summary: "hand written summary",
      summaryStatus: "ready",
    });

    // A late failure outcome must likewise leave the ready summary intact.
    const afterFail = expectCollectionItem(
      await writeGeneratedSummary(userId, collection.id, item.id, { status: "failed" }),
    );
    expect(afterFail).toMatchObject({
      summary: "hand written summary",
      summaryStatus: "ready",
    });
  });

  it("writeGeneratedSummary marks a pending item failed without writing a summary", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Generate failed" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "genfailedxx",
    }, noFacts));

    const failed = expectCollectionItem(
      await writeGeneratedSummary(userId, collection.id, item.id, { status: "failed" }),
    );
    expect(failed).toMatchObject({ summary: null, summaryStatus: "failed" });

    // Retry can still succeed off a failed item.
    const retried = expectCollectionItem(
      await writeGeneratedSummary(userId, collection.id, item.id, {
        status: "ready",
        summary: "recovered summary",
      }),
    );
    expect(retried).toMatchObject({ summary: "recovered summary", summaryStatus: "ready" });
  });

  it("getCollectionItem returns the item for its owner and null for a stranger", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const collection = await createCollection(userId, { title: "Fetch single item" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "fetchsingle",
      startSec: 3,
      endSec: 9,
    }, noFacts));

    const fetched = await getCollectionItem(userId, collection.id, item.id);
    expect(fetched).toMatchObject({ id: item.id, videoId: "fetchsingle", startSec: 3, endSec: 9 });

    const stranger = await getCollectionItem("vitest-stranger", collection.id, item.id);
    expect(stranger).toBeNull();
  });

  it("appends a random suffix when sharing collides with an existing slug", async () => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }

    const title = `Share collision ${Date.now()}`;
    const first = await createCollection(userId, { title });
    cleanupCollectionIds.push(first.id);
    const second = await createCollection(userId, { title });
    cleanupCollectionIds.push(second.id);

    const firstShare = await setCollectionShared(userId, first.id, true);
    const secondShare = await setCollectionShared(userId, second.id, true, () => "9f9f");

    expect(firstShare?.slug).toBeTruthy();
    expect(secondShare?.slug).toBe(`${firstShare?.slug}-9f9f`);
  });
});

describe("collection item video facts", () => {
  const userId = `vitest-facts-${Date.now()}`;
  const cleanupCollectionIds: string[] = [];
  const cleanupDigestIds: string[] = [];

  function requireDb(): void {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for collections db integration tests");
    }
  }

  function resolverReturning(facts: ResolvedVideoFacts): VideoFactsResolver {
    return vi.fn(async () => facts);
  }

  afterAll(async () => {
    for (const id of cleanupCollectionIds) {
      await sql`DELETE FROM collections WHERE id = ${id}`;
    }
    for (const id of cleanupDigestIds) {
      await sql`DELETE FROM digests WHERE id = ${id}`;
    }
  });

  it("stores the title and runtime the resolver returns for a video that was never briefed", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Fetched facts" });
    cleanupCollectionIds.push(collection.id);

    const resolve = resolverReturning({ title: "Live YouTube Title", durationSec: 612 });
    const item = expectCollectionItem(
      await addCollectionItem(userId, collection.id, { videoId: "neverbrief" + "1" }, resolve),
    );

    expect(item).toMatchObject({ videoTitle: "Live YouTube Title", durationSec: 612 });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(userId, "neverbrief1");
  });

  it("stores null facts and still saves the item when the lookup finds nothing", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Unresolvable facts" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(userId, collection.id, { videoId: "notitlexxxx" }, noFacts),
    );

    expect(item.videoTitle).toBeNull();
    expect(item.durationSec).toBeNull();
    expect(item.videoId).toBe("notitlexxxx");
  });

  it("stores a runtime even when the same lookup could not name the video", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Runtime without title" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "untitledxxx" },
        resolverReturning({ title: null, durationSec: 90 }),
      ),
    );

    expect(item).toMatchObject({ videoTitle: null, durationSec: 90 });
  });

  it("still saves the item when the facts lookup throws", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Throwing lookup" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(userId, collection.id, { videoId: "throwsxxxxx" }, async () => {
        throw new Error("youtube is down");
      }),
    );

    expect(item.videoTitle).toBeNull();
    expect(item.durationSec).toBeNull();
    expect(item.videoId).toBe("throwsxxxxx");
  });

  it("keeps the stored facts when only the clip bounds are edited", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Bounds-only edit" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "boundsxxxxx", startSec: 10, endSec: 40 },
        resolverReturning({ title: "Stored Title", durationSec: 900 }),
      ),
    );
    expect(item).toMatchObject({ videoTitle: "Stored Title", durationSec: 900 });

    const resolve = resolverReturning({ title: null, durationSec: null });
    const edited = expectCollectionItem(
      await updateCollectionItem(
        userId,
        collection.id,
        item.id,
        { startSec: 20, endSec: 50 },
        resolve,
      ),
    );

    expect(edited).toMatchObject({ videoTitle: "Stored Title", durationSec: 900 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("keeps the stored facts when the same videoId is resent alongside new bounds", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Same video resent" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "resentxxxxx", startSec: 5 },
        resolverReturning({ title: "Stored Title", durationSec: 1200 }),
      ),
    );

    const resolve = resolverReturning({ title: null, durationSec: null });
    const edited = expectCollectionItem(
      await updateCollectionItem(
        userId,
        collection.id,
        item.id,
        { videoId: "resentxxxxx", startSec: 12, endSec: 30 },
        resolve,
      ),
    );

    expect(edited).toMatchObject({
      videoTitle: "Stored Title",
      durationSec: 1200,
      startSec: 12,
      endSec: 30,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refreshes the title and runtime when the item points at a genuinely different video", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Swapped video" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "originalxxx" },
        resolverReturning({ title: "Original Title", durationSec: 300 }),
      ),
    );
    expect(item.durationSec).toBe(300);

    const resolve = resolverReturning({ title: "Replacement Title", durationSec: 480 });
    const swapped = expectCollectionItem(
      await updateCollectionItem(userId, collection.id, item.id, { videoId: "replacedxxx" }, resolve),
    );

    expect(swapped).toMatchObject({
      videoId: "replacedxxx",
      videoTitle: "Replacement Title",
      durationSec: 480,
    });
    expect(resolve).toHaveBeenCalledWith(userId, "replacedxxx");
  });

  it("leaves the collection writable while a facts lookup is in flight", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Lock during lookup" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(userId, collection.id, { videoId: "lockbeforex" }, noFacts),
    );

    const lookupMs = 5000;
    let lookupFinished = false;
    const slowResolve: VideoFactsResolver = async () => {
      await new Promise((resolve) => setTimeout(resolve, lookupMs));
      lookupFinished = true;
      return { title: "Swapped Title", durationSec: 480 };
    };

    const swap = updateCollectionItem(
      userId,
      collection.id,
      item.id,
      { videoId: "lockafterxx" },
      slowResolve,
    );

    // Long enough for the swap to have reached its lookup, short enough that
    // the lookup is still running when the concurrent write starts.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const startedAt = Date.now();
    const concurrent = expectCollectionItem(
      await addCollectionItem(userId, collection.id, { videoId: "concurrent1" }, noFacts),
    );
    const concurrentMs = Date.now() - startedAt;

    // The add must have gone through while the lookup was still outstanding: a
    // lookup running under the collection's row lock would have made it wait.
    expect(concurrent.videoId).toBe("concurrent1");
    expect(concurrentMs).toBeLessThan(lookupMs / 2);
    expect(lookupFinished).toBe(false);

    expect(expectCollectionItem(await swap)).toMatchObject({
      videoId: "lockafterxx",
      videoTitle: "Swapped Title",
      durationSec: 480,
    });
  }, 30000);

  it("never spends a facts lookup for a user who does not own the collection", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Owner only" });
    cleanupCollectionIds.push(collection.id);

    // The lookup is a metered YouTube call on a quota the whole app shares, so
    // reaching it must take ownership, not just a session.
    const resolve = resolverReturning({ title: "Never Fetched", durationSec: 60 });
    const added = await addCollectionItem(
      `${userId}-stranger`,
      collection.id,
      { videoId: "strangerxxx" },
      resolve,
    );

    expect(added).toBeNull();
    expect(resolve).not.toHaveBeenCalled();

    const items = await getCollectionWithItems(userId, collection.id);
    expect(items?.items).toEqual([]);
  });

  it("never spends a facts lookup on an edit the merged bounds already doom", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Doomed edit" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "doomedxxxxx", startSec: 5, endSec: 15 },
        resolverReturning({ title: "Stored Title", durationSec: 300 }),
      ),
    );

    // A partial edit: only startSec is sent, so the request-level check that
    // compares the two bounds has nothing to compare. The stored endSec of 15 is
    // what makes a startSec of 42 unwritable, and the row carrying it is read
    // before the lookup is spent.
    const resolve = resolverReturning({ title: "Replacement Title", durationSec: 480 });
    await expect(
      updateCollectionItem(
        userId,
        collection.id,
        item.id,
        { videoId: "newvideoid1", startSec: 42 },
        resolve,
      ),
    ).rejects.toBeInstanceOf(InvalidClipRangeError);

    expect(resolve).not.toHaveBeenCalled();

    const unchanged = expectCollectionItem(await getCollectionItem(userId, collection.id, item.id));
    expect(unchanged).toMatchObject({
      videoId: "doomedxxxxx",
      startSec: 5,
      endSec: 15,
      videoTitle: "Stored Title",
      durationSec: 300,
    });
  });

  it("stores null instead of a runtime the column cannot hold, and still saves the item", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Out-of-domain runtimes" });
    cleanupCollectionIds.push(collection.id);

    const unusable = [0, -1, 1.5, Number.NaN, 2147483648];
    for (const [index, durationSec] of unusable.entries()) {
      const item = expectCollectionItem(
        await addCollectionItem(
          userId,
          collection.id,
          { videoId: `baddur${index}xxxx` },
          resolverReturning({ title: "Kept Title", durationSec }),
        ),
      );
      expect(item).toMatchObject({ videoTitle: "Kept Title", durationSec: null });
    }
  });

  it("stores null instead of a blank title, and still saves the item", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Blank titles" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "blanktitle1" },
        resolverReturning({ title: "   ", durationSec: 120 }),
      ),
    );
    expect(item).toMatchObject({ videoTitle: null, durationSec: 120 });
  });

  it("clamps an unusable runtime on the update path too", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Swap to bad runtime" });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "swapfromxxx" },
        resolverReturning({ title: "Original Title", durationSec: 300 }),
      ),
    );

    const swapped = expectCollectionItem(
      await updateCollectionItem(
        userId,
        collection.id,
        item.id,
        { videoId: "swaptobadxx" },
        resolverReturning({ title: "New Title", durationSec: 0 }),
      ),
    );
    expect(swapped).toMatchObject({ videoTitle: "New Title", durationSec: null });
  });

  it("surfaces the stored runtime through every collection item read", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: `Runtime reads ${Date.now()}` });
    cleanupCollectionIds.push(collection.id);

    const item = expectCollectionItem(
      await addCollectionItem(
        userId,
        collection.id,
        { videoId: "readsxxxxxx" },
        resolverReturning({ title: "Read Me", durationSec: 1234 }),
      ),
    );

    const listed = await getCollectionWithItems(userId, collection.id);
    expect(listed?.items[0].durationSec).toBe(1234);

    const single = await getCollectionItem(userId, collection.id, item.id);
    expect(single?.durationSec).toBe(1234);

    const summarized = await updateCollectionItem(userId, collection.id, item.id, {
      summary: "a note",
    });
    expect(summarized?.durationSec).toBe(1234);

    const generated = await writeGeneratedSummary(userId, collection.id, item.id, {
      status: "failed",
    });
    expect(generated?.durationSec).toBe(1234);

    const shared = await setCollectionShared(userId, collection.id, true);
    const sharedSlug = shared?.slug;
    if (!sharedSlug) throw new Error("Expected the shared collection to have a slug");
    const publicView = await getSharedCollectionBySlug(sharedSlug);
    expect(publicView?.items[0].durationSec).toBe(1234);
  });

  it("refuses to store a non-positive runtime", async () => {
    requireDb();

    const collection = await createCollection(userId, { title: "Zero runtime" });
    cleanupCollectionIds.push(collection.id);

    await expect(
      sql`
        INSERT INTO collection_items (collection_id, video_id, position, duration_sec)
        VALUES (${collection.id}, 'zeroruntime', 1, 0)
      `,
    ).rejects.toThrow(/collection_items_duration_sec_check/);
  });

  it("falls back to a briefed title and runtime when YouTube yields nothing", async () => {
    requireDb();

    const videoId = "fallbackxxx";
    const briefTitle = `Briefed Title ${Date.now()}`;
    const inserted = await sql<{ id: string }>`
      INSERT INTO digests (
        user_id, video_id, title, channel_name, channel_slug,
        summary, sections, related_links, other_links, status, duration
      )
      VALUES (
        ${userId}, ${videoId}, ${briefTitle}, 'Test Channel', 'test-channel',
        'summary', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'completed', 'PT10M30S'
      )
      RETURNING id
    `;
    cleanupDigestIds.push(inserted.rows[0].id);

    const originalKey = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      expect(await resolveCollectionVideoFacts(userId, videoId)).toEqual({
        title: briefTitle,
        durationSec: 630,
      });
      expect(await resolveCollectionVideoFacts(userId, "nobriefxxxx")).toEqual({
        title: null,
        durationSec: null,
      });
    } finally {
      if (originalKey !== undefined) process.env.YOUTUBE_API_KEY = originalKey;
    }
  });

  it("getCollection returns the collection's own title and description for its owner", async () => {
    requireDb();

    const collection = await createCollection(userId, {
      title: "Curated for the summarizer",
      description: "Clips that argue the same point from different angles",
    });
    cleanupCollectionIds.push(collection.id);

    expect(await getCollection(userId, collection.id)).toMatchObject({
      title: "Curated for the summarizer",
      description: "Clips that argue the same point from different angles",
    });
    expect(await getCollection("vitest-stranger", collection.id)).toBeNull();
  });
});
