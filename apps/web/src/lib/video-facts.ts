import { fetchMetadata } from "@brief/core";
import type { MetadataResult } from "@brief/core";
import { parseDurationToSeconds } from "./chapters";

/**
 * What a video reveals about itself to a feature that only holds its ID.
 * Each field is independently nullable: YouTube can answer with a usable title
 * and an unusable runtime (live broadcasts report no length), and callers store
 * whichever fields arrived.
 */
export interface YouTubeVideoFacts {
  title: string | null;
  durationSec: number | null;
}

/**
 * How long one metadata lookup may take before it is abandoned as a failure.
 *
 * The YouTube client retries a failing `videos.list` several times and imposes
 * no ceiling of its own, so without this bound a stalled or repeatedly-retried
 * request would keep an interactive add or edit waiting indefinitely. A healthy
 * lookup answers in a fraction of a second; anything past this is a fault, and
 * a fault here costs a null field, never the user's write.
 */
export const METADATA_TIMEOUT_MS = 5_000;

/**
 * The placeholder `fetchMetadata` substitutes when YouTube returns a video with
 * no snippet, and therefore no title. It is a stand-in for the absence of a
 * name, not a name, so treating it as a real title would store a lie and stop
 * callers from consulting their own fallbacks. The cost of the same treatment
 * for a video genuinely called "Untitled" is that those callers get a chance to
 * name it better, which is not a cost worth avoiding.
 */
const MISSING_TITLE_PLACEHOLDER = "Untitled";

const TIMED_OUT = Symbol("metadata-lookup-timed-out");

function emptyFacts(): YouTubeVideoFacts {
  return { title: null, durationSec: null };
}

/**
 * Resolves to `TIMED_OUT` when `work` has not settled within `ms`. The loser of
 * the race is left to settle on its own; `Promise.race` has already claimed its
 * result, so a late rejection cannot surface as an unhandled one.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reduces whatever arrived in the title field to a usable name or `null`.
 * Accepts `unknown` because this is the boundary with a third-party client: the
 * declared response type describes what YouTube should send, not what a caller
 * is guaranteed to receive.
 */
function normalizeTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  return trimmed === MISSING_TITLE_PLACEHOLDER ? null : trimmed;
}

/**
 * Converts YouTube's ISO 8601 runtime into whole seconds, treating a zero-length
 * result as "unknown" rather than as a real duration. `fetchMetadata` substitutes
 * "PT0S" whenever contentDetails is absent (live and upcoming broadcasts), and a
 * zero runtime is unusable to anything that divides by it, so `null` is the
 * honest answer. Anything that is not a string is likewise unknown.
 */
function normalizeDurationSec(isoDuration: unknown): number | null {
  if (typeof isoDuration !== "string") return null;
  const seconds = parseDurationToSeconds(isoDuration);
  return seconds > 0 ? seconds : null;
}

/**
 * Reads a video's current title and runtime straight from YouTube, in one
 * lookup.
 *
 * This is the metadata source for features that reference a video without
 * having briefed it (collections), so it is deliberately total: every failure
 * mode (no API key, quota exhausted, deleted video, network fault, a stalled
 * request, a thrown error from the client library) resolves to empty facts
 * rather than throwing. Callers treat a null field as "not known yet" and carry
 * on, so a YouTube outage degrades the display instead of failing the user's
 * action.
 *
 * The two fields are derived independently, so a value the response could not
 * supply in one of them never erases the other.
 *
 * The key is read per call rather than at module load so a deployment that
 * rotates `YOUTUBE_API_KEY` takes effect without a cold start.
 */
export async function fetchYouTubeVideoFacts(videoId: string): Promise<YouTubeVideoFacts> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return emptyFacts();

  let result: MetadataResult | typeof TIMED_OUT;
  try {
    result = await withTimeout(
      fetchMetadata(videoId, { youtubeApiKey: apiKey }),
      METADATA_TIMEOUT_MS,
    );
  } catch {
    return emptyFacts();
  }

  if (result === TIMED_OUT || result.kind !== "ok") return emptyFacts();

  return {
    title: normalizeTitle(result.metadata.title),
    durationSec: normalizeDurationSec(result.metadata.duration),
  };
}
