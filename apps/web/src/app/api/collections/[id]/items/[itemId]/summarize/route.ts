import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  getCollection,
  getCollectionItem,
  writeGeneratedSummary,
  type CollectionItem,
} from "@/lib/collections";
import { getBriefByVideoId } from "@/lib/db";
import { isEmailAllowed } from "@/lib/access";
import { fetchTranscript } from "@/lib/transcript";
import { createServerLlmGateway } from "@/lib/llm-gateway";
import { createOpenRouterClient } from "@/lib/openrouter-client";
import { createPgUsageLedger } from "@/lib/usage-ledger";
import { sliceTranscriptRange, rangeTranscriptText } from "@/lib/transcript-range";
import type { StoredTranscriptEntry } from "@/lib/types";

/**
 * Client-driven async summarization for a collection item.
 *
 * Serverless functions cannot reliably do post-response background work, so the
 * add-item UI calls this endpoint after a successful add and refreshes the row
 * with the returned item. The endpoint is idempotent: if the item is already
 * 'ready' it no-ops and returns the item unchanged, so a re-run or a retry
 * against a hand-edited summary never clobbers it.
 *
 * On any generation failure (no transcript, empty slice, LLM or ledger fault)
 * the item is marked 'failed' and returned with a 200. The add already
 * succeeded; a failed summary is a state the author can retry or hand-write,
 * not an error that unwinds the add.
 *
 * This route is an addition beyond the originally approved collections API
 * contract. See the review packet's contract-amendment note.
 */

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { user } = await withAuth();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Summarizing spends LLM tokens per call, so this endpoint is allowlist-gated
    // like the brief-generation routes. Owner-scoped collection CRUD stays
    // withAuth-only; only the token-spending path carries the allowlist.
    if (!isEmailAllowed(user.email)) {
      return NextResponse.json({ error: "Access restricted" }, { status: 403 });
    }

    const { id, itemId } = await params;

    // The collection's own title and description are prompt context, not a
    // permission check, so both reads run together rather than in sequence.
    const [item, collection] = await Promise.all([
      getCollectionItem(user.id, id, itemId),
      getCollection(user.id, id),
    ]);
    if (!item || !collection) {
      return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
    }

    // Idempotent no-op: a ready summary (machine- or hand-written) is authoritative.
    if (item.summaryStatus === "ready") {
      return NextResponse.json(item);
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      console.error("[SUMMARIZE ITEM] Missing OPENROUTER_API_KEY");
      return NextResponse.json({ error: "Summarization is unavailable" }, { status: 503 });
    }

    let entries: StoredTranscriptEntry[];
    try {
      entries = await acquireTranscriptEntries(user.id, item.videoId);
    } catch (error) {
      console.error("[SUMMARIZE ITEM] transcript acquisition failed:", error);
      return await failItem(user.id, id, itemId);
    }

    const sliced = sliceTranscriptRange(entries, item.startSec, item.endSec);
    const transcriptText = rangeTranscriptText(sliced);
    if (transcriptText.length === 0) {
      return await failItem(user.id, id, itemId);
    }

    const rangeSeconds = deriveRangeSeconds(item, sliced);

    const gateway = createServerLlmGateway({
      ledger: createPgUsageLedger(),
      openrouter: createOpenRouterClient({ apiKey: openRouterKey }),
    });

    let result;
    try {
      result = await gateway.summarize({
        userId: user.id,
        transcriptText,
        rangeSeconds,
        ...(item.videoTitle ? { videoTitle: item.videoTitle } : {}),
        collection: { title: collection.title, description: collection.description },
      });
    } catch (error) {
      console.error("[SUMMARIZE ITEM] gateway threw:", error);
      return await failItem(user.id, id, itemId);
    }

    if (result.kind !== "ok") {
      if (result.reason === "transient" || result.reason === "auth") {
        console.error(`[SUMMARIZE ITEM] ${result.reason}:`, result.message);
      }
      return await failItem(user.id, id, itemId);
    }

    const updated = await writeGeneratedSummary(user.id, id, itemId, {
      status: "ready",
      summary: result.summary,
    });
    if (!updated) {
      return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[SUMMARIZE ITEM] Error:", error);
    return NextResponse.json({ error: "Failed to summarize item" }, { status: 500 });
  }
}

/**
 * Marks the item 'failed' and returns it with a 200. `writeGeneratedSummary`
 * leaves a 'ready' item untouched, so a failure racing a hand-edit can never
 * downgrade the author's summary.
 */
async function failItem(
  userId: string,
  collectionId: string,
  itemId: string,
): Promise<NextResponse> {
  const failed = await writeGeneratedSummary(userId, collectionId, itemId, {
    status: "failed",
  });
  if (!failed) {
    return NextResponse.json({ error: "Collection item not found" }, { status: 404 });
  }
  return NextResponse.json(failed);
}

/**
 * Loads transcript entries for the item's video. Prefers the transcript already
 * stored on the user's brief for this video; falls back to `@brief/core`'s fetch
 * cascade for videos never briefed. Throws when no transcript is obtainable.
 */
async function acquireTranscriptEntries(
  userId: string,
  videoId: string,
): Promise<StoredTranscriptEntry[]> {
  const brief = await getBriefByVideoId(userId, videoId);
  const stored = brief?.transcript?.entries;
  if (stored && stored.length > 0) {
    return stored;
  }

  const fetched = await fetchTranscript(videoId);
  if (fetched.entries.length === 0) {
    throw new Error("transcript fetch returned no entries");
  }
  return fetched.entries.map((entry) => ({
    text: entry.text,
    offsetSec: entry.offset,
    durationSec: entry.duration,
    ...(entry.lang ? { lang: entry.lang } : {}),
  }));
}

/**
 * Derives the range length that drives prompt proportionality. Both bounds
 * null is a whole-Short item (null length). When both bounds are set the exact
 * span is used; an open-ended clip falls back to the actual sliced span.
 */
function deriveRangeSeconds(
  item: CollectionItem,
  sliced: StoredTranscriptEntry[],
): number | null {
  if (item.startSec === null && item.endSec === null) {
    return null;
  }
  if (item.startSec !== null && item.endSec !== null) {
    return Math.max(1, item.endSec - item.startSec);
  }
  const first = sliced[0];
  const last = sliced[sliced.length - 1];
  const span = last.offsetSec + Math.max(0, last.durationSec) - first.offsetSec;
  return Math.max(1, Math.round(span));
}
