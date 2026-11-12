/**
 * Writing a clip's words: the title and note the AI owns, generated in one call
 * from the clip's own stretch of transcript and written back without touching
 * anything the author wrote by hand.
 */

import {
  getCollection,
  getCollectionItem,
  writeGeneratedClipWords,
  type CollectionItem,
} from "./collections";
import { getBriefByVideoId } from "./db";
import { createServerLlmGateway, type ServerLlmGateway } from "./llm-gateway";
import { createOpenRouterClient } from "./openrouter-client";
import type { ClipWordsWanted } from "./summary-prompt";
import { fetchTranscript } from "./transcript";
import { rangeTranscriptText, sliceTranscriptRange } from "./transcript-range";
import type { StoredTranscriptEntry } from "./types";
import { createPgUsageLedger } from "./usage-ledger";

/** What writing a clip's words reaches outside the database for. */
export interface ClipWordsDeps {
  gateway: Pick<ServerLlmGateway, "writeClipWords">;
  /** Throws when the video has no obtainable transcript. */
  loadTranscript: (userId: string, videoId: string) => Promise<StoredTranscriptEntry[]>;
}

/**
 * The words generation still owes the clip: those the AI owns and has not
 * written. A word the author wrote is theirs, and a word the AI already wrote
 * for this footage stands, so neither is asked for again.
 */
const wantedClipWords = (item: CollectionItem): ClipWordsWanted | null => {
  const title = !item.titleAuthored && item.title === null;
  const note = !item.summaryAuthored && item.summary === null;
  if (title && note) return "both";
  if (title) return "title";
  if (note) return "note";
  return null;
};

/**
 * The range length that drives the note's proportionality. Both bounds null is
 * a whole-Short item (null length). When both bounds are set the exact span is
 * used; an open-ended clip falls back to the actual sliced span.
 */
const deriveRangeSeconds = (item: CollectionItem, sliced: StoredTranscriptEntry[]): number | null => {
  if (item.startSec === null && item.endSec === null) return null;
  if (item.startSec !== null && item.endSec !== null) return Math.max(1, item.endSec - item.startSec);
  const first = sliced[0];
  const last = sliced[sliced.length - 1];
  const span = last.offsetSec + Math.max(0, last.durationSec) - first.offsetSec;
  return Math.max(1, Math.round(span));
};

const loadClipTranscriptText = async (
  userId: string,
  item: CollectionItem,
  deps: ClipWordsDeps,
): Promise<{ text: string; rangeSeconds: number | null } | { reason: string }> => {
  let entries: StoredTranscriptEntry[];
  try {
    entries = await deps.loadTranscript(userId, item.videoId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reason: `no transcript for ${item.videoId}: ${message}` };
  }
  const sliced = sliceTranscriptRange(entries, item.startSec, item.endSec);
  const text = rangeTranscriptText(sliced);
  if (text.length === 0) return { reason: "transcript has nothing in the clip's range" };
  return { text, rangeSeconds: deriveRangeSeconds(item, sliced) };
};

/** The collection a clip sits in, as the model is told about it. */
interface ClipCollectionContext {
  title: string;
  description: string | null;
}

/** What one generation run produced: the words asked for (null for any not asked), or why there are none. */
type ClipWordsGeneration =
  | { kind: "ok"; title: string | null; note: string | null }
  | { kind: "failed"; reason: string };

/**
 * Asks the model for the clip's wanted words from the clip's own stretch of
 * transcript, spending on `userId`'s account. Writes nothing.
 */
const generateClipWords = async (
  userId: string,
  item: CollectionItem,
  collection: ClipCollectionContext,
  wants: ClipWordsWanted,
  deps: ClipWordsDeps,
): Promise<ClipWordsGeneration> => {
  const transcript = await loadClipTranscriptText(userId, item, deps);
  if ("reason" in transcript) return { kind: "failed", reason: transcript.reason };

  const result = await deps.gateway.writeClipWords({
    userId,
    wants,
    transcriptText: transcript.text,
    rangeSeconds: transcript.rangeSeconds,
    ...(item.videoTitle ? { videoTitle: item.videoTitle } : {}),
    collection: { title: collection.title, description: collection.description },
  });
  if (result.kind !== "ok") return { kind: "failed", reason: `generation failed (${result.reason}): ${result.message}` };
  return { kind: "ok", title: result.title, note: result.note };
};

/**
 * Generates and writes whatever words the clip is still owed, then settles it
 * 'ready', or 'failed' when no words could be had. A clip already 'ready' is
 * left as it is. Every failure is a state the author can retry or write over,
 * so none of them throws. Returns the clip's resulting state, or null when it
 * is not the user's.
 */
const writeClipWords = async (
  userId: string,
  collectionId: string,
  itemId: string,
  deps: ClipWordsDeps,
): Promise<CollectionItem | null> => {
  const [item, collection] = await Promise.all([
    getCollectionItem(userId, collectionId, itemId),
    getCollection(userId, collectionId),
  ]);
  if (!item || !collection) return null;
  if (item.summaryStatus === "ready") return item;

  const wants = wantedClipWords(item);
  if (wants === null) {
    return writeGeneratedClipWords(userId, collectionId, item, { status: "ready", title: null, summary: null });
  }

  const generated = await generateClipWords(userId, item, collection, wants, deps);
  if (generated.kind === "failed") {
    console.error(`[CLIP WORDS] item ${item.id}: ${generated.reason}`);
    return writeGeneratedClipWords(userId, collectionId, item, { status: "failed" });
  }

  return writeGeneratedClipWords(userId, collectionId, item, {
    status: "ready",
    title: generated.title,
    summary: generated.note,
  });
};

/**
 * Prefers the transcript already stored on the user's brief for this video and
 * falls back to `@brief/core`'s fetch cascade for videos never briefed.
 */
const loadClipTranscript = async (userId: string, videoId: string): Promise<StoredTranscriptEntry[]> => {
  const brief = await getBriefByVideoId(userId, videoId);
  const stored = brief?.transcript?.entries;
  if (stored && stored.length > 0) return stored;

  const fetched = await fetchTranscript(videoId);
  if (fetched.entries.length === 0) throw new Error("transcript fetch returned no entries");
  return fetched.entries.map((entry) => ({
    text: entry.text,
    offsetSec: entry.offset,
    durationSec: entry.duration,
    ...(entry.lang ? { lang: entry.lang } : {}),
  }));
};

const createClipWordsDeps = (openRouterKey: string): ClipWordsDeps => ({
  gateway: createServerLlmGateway({
    ledger: createPgUsageLedger(),
    openrouter: createOpenRouterClient({ apiKey: openRouterKey }),
  }),
  loadTranscript: loadClipTranscript,
});

export { createClipWordsDeps, generateClipWords, writeClipWords };
export type { ClipCollectionContext, ClipWordsGeneration };
