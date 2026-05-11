import { fetchTranscript as fetchTranscriptCore } from "@brief/core";
import type { SourceName, TranscriptEntry } from "./types";

/**
 * Result of fetching a video's transcript. Carries the speech entries (web
 * shape: offset/duration in seconds), the source that produced them, and the
 * detected language when known. Persistence layers can reshape entries to
 * `@brief/core`'s canonical `offsetSec/durationSec` form for storage.
 */
export interface FetchedTranscript {
  entries: TranscriptEntry[];
  source: SourceName;
  lang?: string;
}

/**
 * Fetches the transcript for a YouTube video via `@brief/core`'s cascade.
 *
 * Source selection preserves the original env-driven exclusivity: when
 * `SUPADATA_API_KEY` is set, only Supadata is used (cloud deployments);
 * otherwise only `youtube-transcript-plus` is used (local development).
 * The core layer provides retry policy + structured outcomes for free.
 *
 * @param videoId - YouTube video ID
 * @returns Entries, source, and detected language
 * @throws Error with a user-facing message; the brief API routes surface
 *         these via `body.error` and the Chrome extension reads them directly,
 *         so the wording is part of the contract.
 */
export async function fetchTranscript(
  videoId: string,
): Promise<FetchedTranscript> {
  const startTime = Date.now();
  const supadataApiKey = process.env.SUPADATA_API_KEY;
  const useSupadata = !!supadataApiKey;

  console.log(
    `[TRANSCRIPT] Starting fetch for videoId: ${videoId} using ${useSupadata ? "Supadata API" : "youtube-transcript-plus (local mode)"}`,
  );

  const result = await fetchTranscriptCore(videoId, {
    supadataApiKey,
    sources: useSupadata ? ["supadata"] : ["youtube-transcript-plus"],
  });

  if (result.kind === "ok") {
    const entries: TranscriptEntry[] = result.entries.map((e) => ({
      text: e.text,
      offset: e.offsetSec,
      duration: e.durationSec,
      lang: e.lang,
    }));
    console.log(
      `[TRANSCRIPT] Success in ${Date.now() - startTime}ms, entries: ${entries.length}`,
    );
    return {
      entries,
      source: result.source,
      ...(result.lang ? { lang: result.lang } : {}),
    };
  }

  console.error(
    `[TRANSCRIPT] Failed in ${Date.now() - startTime}ms: ${result.kind} — ${result.message}`,
  );

  if (result.kind === "pending") {
    throw new Error(
      "This video's transcript is being generated. Please try again in 1-2 minutes.",
    );
  }

  if (result.kind === "unavailable") {
    if (result.reason === "no-captions") {
      throw new Error(
        "No captions/transcript available for this video. Try a video with auto-generated or manual captions.",
      );
    }
    if (result.reason === "video-removed" || result.reason === "video-private") {
      throw new Error("Video is unavailable or has been removed");
    }
    if (result.reason === "invalid-id") {
      throw new Error("Invalid video ID");
    }
  }

  // Transient (or any other failure). Supadata's credit/billing/quota errors
  // surface as transient messages; preserve the dedicated user-facing string
  // for those so operators know what to fix.
  const msg = result.message.toLowerCase();
  if (
    msg.includes("credit") ||
    msg.includes("billing") ||
    msg.includes("subscription") ||
    msg.includes("limit exceeded")
  ) {
    throw new Error(
      "Supadata API credits exhausted. Please add credits in your Supadata dashboard.",
    );
  }

  throw new Error(`Failed to fetch transcript: ${result.message}`);
}
