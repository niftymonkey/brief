import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@vercel/postgres";
import {
  type CollectionItem,
  type UntitledClip,
  type VideoFactsResolver,
  addCollectionItem,
  createCollection,
  getCollectionItem,
  listUntitledClips,
  updateCollectionItem,
  writeGeneratedClipWords,
} from "./collections";
import { backfillClipTitles, type ClipTitleOutcome } from "./clip-title-backfill";
import type { ClipWordsDeps } from "./clip-words";
import type { WriteClipWordsInput } from "./llm-gateway";
import type { StoredTranscriptEntry } from "./types";

const noFacts: VideoFactsResolver = async () => ({ title: null, durationSec: null, aspectRatio: null });

const TRANSCRIPT: StoredTranscriptEntry[] = [
  { text: "first the speaker sets the scene", offsetSec: 0, durationSec: 10 },
  { text: "then the deal goes wrong", offsetSec: 10, durationSec: 20 },
  { text: "and everyone leaves", offsetSec: 30, durationSec: 40 },
];

interface FakeGateway {
  deps: ClipWordsDeps;
  calls: WriteClipWordsInput[];
}

/** A gateway that titles every clip after its video, and throws for the video named `brokenVideoId`. */
const fakeGatewayTitling = (brokenVideoId?: string): FakeGateway => {
  const calls: WriteClipWordsInput[] = [];
  return {
    calls,
    deps: {
      gateway: {
        async writeClipWords(input) {
          calls.push(input);
          if (brokenVideoId && input.videoTitle === brokenVideoId) throw new Error("upstream exploded");
          return {
            kind: "ok",
            title: `Title for ${input.videoTitle ?? "clip"}`,
            note: null,
            inputTokens: 10,
            outputTokens: 5,
            ledgerId: "ledger-1",
            model: "fake",
          };
        },
      },
      loadTranscript: async () => TRANSCRIPT,
    },
  };
};

describe("backfillClipTitles", () => {
  const runToken = Date.now().toString(36);
  const userId = `vitest-title-backfill-${runToken}`;
  const cleanupCollectionIds: string[] = [];

  afterAll(async () => {
    for (const id of cleanupCollectionIds) {
      await sql`DELETE FROM collections WHERE id = ${id}`;
    }
  });

  const createTrackedCollection = async (title: string): Promise<string> => {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for the clip title backfill db integration tests");
    }
    const collection = await createCollection(userId, { title });
    cleanupCollectionIds.push(collection.id);
    return collection.id;
  };

  /**
   * Adds a clip in the shape every clip from before titles has: settled
   * 'ready' with the AI's note and no title. The video title doubles as the
   * clip's label for the fake gateway.
   */
  const addSettledClip = async (collectionId: string, videoTitle: string): Promise<CollectionItem> => {
    const added = await addCollectionItem(
      userId,
      collectionId,
      { videoId: `tb${runToken}`, startSec: 5, endSec: 40 },
      async () => ({ title: videoTitle, durationSec: null, aspectRatio: null }),
    );
    if (!added) throw new Error("Expected the clip to be added");
    const settled = await writeGeneratedClipWords(userId, collectionId, added, {
      status: "ready",
      title: null,
      summary: `Settled note for ${videoTitle}.`,
    });
    if (!settled) throw new Error("Expected the clip to settle");
    return settled;
  };

  /** The backfill's own listing, narrowed to one collection so the suite never reaches the dev data. */
  const untitledClipsIn = async (collectionId: string): Promise<UntitledClip[]> =>
    (await listUntitledClips()).filter((clip) => clip.collection.id === collectionId);

  const runBackfill = async (collectionId: string, deps: ClipWordsDeps) => {
    const outcomes: ClipTitleOutcome[] = [];
    const tally = await backfillClipTitles(await untitledClipsIn(collectionId), deps, (_clip, outcome) => {
      outcomes.push(outcome);
    });
    return { tally, outcomes };
  };

  const readClip = async (collectionId: string, itemId: string): Promise<CollectionItem | null> =>
    getCollectionItem(userId, collectionId, itemId);

  it("writes a title for a settled clip that has none and leaves its note and status alone", async () => {
    const collectionId = await createTrackedCollection("Settled clips");
    const clip = await addSettledClip(collectionId, "War Dogs");
    const gateway = fakeGatewayTitling();

    const { tally } = await runBackfill(collectionId, gateway.deps);

    expect(tally).toEqual({ written: 1, skipped: 0, failed: 0 });
    // The title is asked for alone, on the owner's account, so the ledger row is theirs.
    expect(gateway.calls.map((call) => [call.wants, call.userId])).toEqual([["title", userId]]);
    expect(await readClip(collectionId, clip.id)).toMatchObject({
      title: "Title for War Dogs",
      titleAuthored: false,
      summary: "Settled note for War Dogs.",
      summaryAuthored: false,
      summaryStatus: "ready",
    });
  });

  it("never overwrites a title the author writes while the backfill runs", async () => {
    const collectionId = await createTrackedCollection("Author titles meanwhile");
    const clip = await addSettledClip(collectionId, "Heat");
    const listed = await untitledClipsIn(collectionId);
    await updateCollectionItem(userId, collectionId, clip.id, { title: "My own title" }, noFacts);

    const tally = await backfillClipTitles(listed, fakeGatewayTitling().deps, () => {});

    expect(tally).toEqual({ written: 0, skipped: 1, failed: 0 });
    expect(await readClip(collectionId, clip.id)).toMatchObject({ title: "My own title", titleAuthored: true });
  });

  it("skips clips that already have a title, so a re-run writes nothing", async () => {
    const collectionId = await createTrackedCollection("Re-run");
    await addSettledClip(collectionId, "Ronin");
    await runBackfill(collectionId, fakeGatewayTitling().deps);
    const rerun = fakeGatewayTitling();

    const { tally } = await runBackfill(collectionId, rerun.deps);

    expect(rerun.calls).toEqual([]);
    expect(tally).toEqual({ written: 0, skipped: 0, failed: 0 });
  });

  it("keeps going after one clip fails and reports why it failed", async () => {
    const collectionId = await createTrackedCollection("One clip fails");
    const broken = await addSettledClip(collectionId, "Broken");
    const fine = await addSettledClip(collectionId, "Fine");
    const gateway = fakeGatewayTitling("Broken");

    const { tally, outcomes } = await runBackfill(collectionId, gateway.deps);

    expect(tally).toEqual({ written: 1, skipped: 0, failed: 1 });
    expect(outcomes[0]).toMatchObject({ kind: "failed" });
    expect(outcomes[0]?.kind === "failed" && outcomes[0].reason).toContain("upstream exploded");
    expect(await readClip(collectionId, broken.id)).toMatchObject({ title: null });
    expect(await readClip(collectionId, fine.id)).toMatchObject({ title: "Title for Fine" });
  });
});
