import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@vercel/postgres";
import {
  type CollectionItem,
  addCollectionItem,
  chooseCollectionSlug,
  createCollection,
  deleteCollection,
  deleteCollectionItem,
  getCollectionWithItems,
  getSharedCollectionBySlug,
  listCollections,
  midpointPosition,
  setCollectionShared,
  updateCollection,
  updateCollectionItem,
} from "./collections";

function expectCollectionItem(item: CollectionItem | null): CollectionItem {
  if (!item) throw new Error("Expected collection item to exist");
  return item;
}

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
    }));
    const second = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "bbbbbbbbbbb",
    }));
    const third = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "ccccccccccc",
    }));

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
    });
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
    }));
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
      await updateCollectionItem(userId, collection.id, item.id, { startSec: 42 }),
    );
    expect(startEdited).toMatchObject({
      startSec: 42,
      endSec: 15,
      summary: null,
      summaryStatus: "pending",
    });
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
    }));
    expect(withNull).toMatchObject({ summary: null, summaryStatus: "pending" });

    const withText = expectCollectionItem(await addCollectionItem(userId, collection.id, {
      videoId: "ggggggggggg",
      summary: "has text",
    }));
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
    }));
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
