import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@vercel/postgres";
import {
  type CollectionItem,
  type VideoFactsResolver,
  addCollectionItem,
  createCollection,
  updateCollectionItem,
  writeGeneratedClipWords,
} from "./collections";
import { writeClipWords, type ClipWordsDeps } from "./clip-words";
import type { WriteClipWordsInput, WriteClipWordsResult } from "./llm-gateway";
import type { StoredTranscriptEntry } from "./types";

const noFacts: VideoFactsResolver = async () => ({ title: null, durationSec: null, aspectRatio: null });

const TRANSCRIPT: StoredTranscriptEntry[] = [
  { text: "first the speaker sets the scene", offsetSec: 0, durationSec: 10 },
  { text: "then the deal goes wrong", offsetSec: 10, durationSec: 20 },
  { text: "and everyone leaves", offsetSec: 30, durationSec: 40 },
  { text: "the credits roll", offsetSec: 70, durationSec: 20 },
];

interface FakeGateway {
  deps: ClipWordsDeps;
  calls: WriteClipWordsInput[];
}

/** A gateway that writes whichever words it is asked for, and remembers every ask. */
const fakeGatewayWriting = (
  reply: (input: WriteClipWordsInput) => WriteClipWordsResult = (input) => ({
    kind: "ok",
    title: input.wants === "note" ? null : "Generated title",
    note: input.wants === "title" ? null : "Generated note.",
    inputTokens: 10,
    outputTokens: 5,
    ledgerId: "ledger-1",
    model: "fake",
  }),
): FakeGateway => {
  const calls: WriteClipWordsInput[] = [];
  return {
    calls,
    deps: {
      gateway: {
        async writeClipWords(input) {
          calls.push(input);
          return reply(input);
        },
      },
      loadTranscript: async () => TRANSCRIPT,
    },
  };
};

describe("writeClipWords", () => {
  const userId = `vitest-clip-words-${Date.now()}`;
  const cleanupCollectionIds: string[] = [];

  afterAll(async () => {
    for (const id of cleanupCollectionIds) {
      await sql`DELETE FROM collections WHERE id = ${id}`;
    }
  });

  const createTrackedCollection = async (title: string): Promise<string> => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for clip words db integration tests");
    }
    const collection = await createCollection(userId, { title });
    cleanupCollectionIds.push(collection.id);
    return collection.id;
  };

  const addClip = async (
    collectionId: string,
    words: { title?: string; summary?: string } = {},
  ): Promise<CollectionItem> => {
    const item = await addCollectionItem(
      userId,
      collectionId,
      { videoId: "clipwordsxx", startSec: 5, endSec: 40, ...words },
      noFacts,
    );
    if (!item) throw new Error("Expected the clip to be added");
    return item;
  };

  it("writes a title and a note when neither is the author's", async () => {
    const collectionId = await createTrackedCollection("Both words generated");
    const clip = await addClip(collectionId);
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls.map((call) => call.wants)).toEqual(["both"]);
    expect(written).toMatchObject({
      title: "Generated title",
      titleAuthored: false,
      summary: "Generated note.",
      summaryAuthored: false,
      summaryStatus: "ready",
    });
  });

  it("writes only a new title when bounds move under a hand-written note and an AI title", async () => {
    const collectionId = await createTrackedCollection("War Dogs");
    const added = await addClip(collectionId, { summary: "My own note about the deal." });
    const titled = await writeGeneratedClipWords(userId, collectionId, added, {
      status: "ready",
      title: "The first title",
      summary: null,
    });
    expect(titled).toMatchObject({ title: "The first title", summaryStatus: "ready" });

    const moved = await updateCollectionItem(
      userId,
      collectionId,
      added.id,
      { startSec: 10, endSec: 70 },
      noFacts,
    );
    expect(moved).toMatchObject({ title: null, summaryStatus: "pending" });
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, added.id, gateway.deps);

    expect(gateway.calls.map((call) => call.wants)).toEqual(["title"]);
    expect(written).toMatchObject({
      title: "Generated title",
      summary: "My own note about the deal.",
      summaryAuthored: true,
      summaryStatus: "ready",
    });
  });

  it("writes only the note when the title is the author's", async () => {
    const collectionId = await createTrackedCollection("Title by hand");
    const clip = await addClip(collectionId, { title: "Named by hand" });
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls.map((call) => call.wants)).toEqual(["note"]);
    expect(written).toMatchObject({
      title: "Named by hand",
      titleAuthored: true,
      summary: "Generated note.",
      summaryStatus: "ready",
    });
  });

  it("asks only for the title when the title is handed back and the AI's note still stands", async () => {
    const collectionId = await createTrackedCollection("Title handed back");
    const clip = await addClip(collectionId, { title: "Named by hand" });
    await writeClipWords(userId, collectionId, clip.id, fakeGatewayWriting().deps);
    const handedBack = await updateCollectionItem(userId, collectionId, clip.id, { title: null });
    expect(handedBack).toMatchObject({ summary: "Generated note.", summaryStatus: "pending" });
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls.map((call) => call.wants)).toEqual(["title"]);
    expect(written).toMatchObject({
      title: "Generated title",
      summary: "Generated note.",
      summaryStatus: "ready",
    });
  });

  it("makes no model call and settles the clip when both words are the author's", async () => {
    const collectionId = await createTrackedCollection("Both by hand");
    const clip = await addClip(collectionId, { title: "Named by hand", summary: "Noted by hand." });
    // A clip whose words are all the author's can still sit at 'pending' from
    // before both were written, which is the state this guards.
    await sql`UPDATE collection_items SET summary_status = 'pending' WHERE id = ${clip.id}`;
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls).toEqual([]);
    expect(written).toMatchObject({
      title: "Named by hand",
      summary: "Noted by hand.",
      summaryStatus: "ready",
    });
  });

  it("makes no model call for a settled clip, even one from before clips had titles", async () => {
    const collectionId = await createTrackedCollection("Already ready");
    const clip = await addClip(collectionId);
    // The shape of every clip that predates titles: ready, with the AI's note
    // and no title. Settled means settled until an edit reopens it.
    await writeGeneratedClipWords(userId, collectionId, clip, {
      status: "ready",
      title: null,
      summary: "Settled note.",
    });
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls).toEqual([]);
    expect(written).toMatchObject({ title: null, summary: "Settled note.", summaryStatus: "ready" });
  });

  it("marks the clip failed when the gateway fails", async () => {
    const collectionId = await createTrackedCollection("Gateway fails");
    const clip = await addClip(collectionId);
    const gateway = fakeGatewayWriting(() => ({
      kind: "failed",
      reason: "transient",
      message: "upstream is down",
    }));

    const written = await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(written).toMatchObject({ title: null, summary: null, summaryStatus: "failed" });
  });

  it("marks the clip failed when no transcript can be had", async () => {
    const collectionId = await createTrackedCollection("No transcript");
    const clip = await addClip(collectionId);
    const gateway = fakeGatewayWriting();
    const deps: ClipWordsDeps = {
      ...gateway.deps,
      loadTranscript: async () => {
        throw new Error("captions are disabled");
      },
    };

    const written = await writeClipWords(userId, collectionId, clip.id, deps);

    expect(gateway.calls).toEqual([]);
    expect(written).toMatchObject({ summaryStatus: "failed" });
  });

  it("gives the model only the clip's own stretch of the transcript", async () => {
    const collectionId = await createTrackedCollection("Clip range");
    const clip = await addClip(collectionId);
    const gateway = fakeGatewayWriting();

    await writeClipWords(userId, collectionId, clip.id, gateway.deps);

    expect(gateway.calls[0]).toMatchObject({ rangeSeconds: 35, collection: { title: "Clip range" } });
    expect(gateway.calls[0]?.transcriptText).toContain("the deal goes wrong");
    expect(gateway.calls[0]?.transcriptText).not.toContain("the credits roll");
  });

  it("answers null for a clip that is not the user's", async () => {
    const collectionId = await createTrackedCollection("Not yours");
    const clip = await addClip(collectionId);
    const gateway = fakeGatewayWriting();

    const written = await writeClipWords("someone-else", collectionId, clip.id, gateway.deps);

    expect(written).toBeNull();
    expect(gateway.calls).toEqual([]);
  });
});
