/**
 * Slices a stored transcript down to the speech that overlaps a collection
 * item's clip range, so a per-clip summary describes the referenced part of the
 * video rather than the whole thing.
 *
 * A `null` bound means "open on that side": both null is the whole video (used
 * for whole-Short items that carry no range). Boundaries are inclusive within a
 * small tolerance so an entry straddling the start or end is pulled in for
 * context instead of being clipped mid-sentence.
 */

import type { StoredTranscriptEntry } from "./types";

/**
 * Seconds of slack applied at each boundary. Transcript entries are a few
 * seconds long, so an entry ending or starting just outside the exact range is
 * still relevant context. Kept small so the slice stays about the clip.
 */
export const DEFAULT_RANGE_TOLERANCE_SEC = 2;

/**
 * Returns the entries whose spoken span `[offsetSec, offsetSec + durationSec]`
 * overlaps `[startSec, endSec]` widened by `toleranceSec` on each side. A null
 * `startSec` opens the low end, a null `endSec` opens the high end, and both
 * null returns every entry.
 */
export function sliceTranscriptRange(
  entries: StoredTranscriptEntry[],
  startSec: number | null,
  endSec: number | null,
  toleranceSec: number = DEFAULT_RANGE_TOLERANCE_SEC,
): StoredTranscriptEntry[] {
  const lo = (startSec ?? Number.NEGATIVE_INFINITY) - toleranceSec;
  const hi = (endSec ?? Number.POSITIVE_INFINITY) + toleranceSec;

  return entries.filter((entry) => {
    const entryStart = entry.offsetSec;
    const entryEnd = entry.offsetSec + Math.max(0, entry.durationSec);
    return entryEnd >= lo && entryStart <= hi;
  });
}

/**
 * Flattens sliced entries into a single whitespace-normalized string suitable
 * for a summarization prompt. Empty entries are dropped and internal runs of
 * whitespace collapse to single spaces.
 */
export function rangeTranscriptText(entries: StoredTranscriptEntry[]): string {
  return entries
    .map((entry) => entry.text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .join(" ");
}
