/**
 * The persistence boundary for the video facts kept on `collection_items`.
 *
 * `YouTubeVideoFacts` describes what a lookup answered, not what the columns
 * can hold. Those are different domains: YouTube reports the runtime of
 * "PT999999999H" as a number far past INTEGER's ceiling, a title can carry a
 * byte Postgres refuses to encode, and an injectable resolver is only as
 * well-behaved as whoever supplied it. Interpolating any of those straight into
 * a statement turns a metadata answer into a failed write.
 *
 * Every write path reduces facts through here first, so an unstorable value
 * costs the field it came in and nothing else. Both writers need it for the
 * same reason and neither owns it, so it lives on its own rather than inside
 * either one.
 */

import type { YouTubeVideoFacts } from "./video-facts";

/** Postgres INTEGER's ceiling, which `collection_items.duration_sec` is. */
const MAX_STORED_DURATION_SEC = 2_147_483_647;

/**
 * Reduces a runtime to a value the column can hold, or to `null`. Zero and
 * negative runtimes fail the duration_sec check constraint, fractions and NaN
 * are not integers at all, and anything past INTEGER's range overflows: every
 * one of them would turn a metadata answer into a failed write.
 */
export function storableDurationSec(durationSec: unknown): number | null {
  if (typeof durationSec !== "number" || !Number.isInteger(durationSec)) return null;
  if (durationSec <= 0 || durationSec > MAX_STORED_DURATION_SEC) return null;
  return durationSec;
}

/**
 * Reduces a title to non-empty text the column can hold, or to `null`.
 *
 * NUL is the one character Postgres `text` cannot store at all: it answers a
 * title containing one with `invalid byte sequence for encoding "UTF8": 0x00`
 * and rejects the whole statement. It is dropped rather than treated as
 * poisoning the title, because the rest of the name is still the video's name.
 */
export function storableTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const trimmed = title.replaceAll("\u0000", "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reduces both fields of a lookup's answer, independently. */
export function storableVideoFacts(facts: YouTubeVideoFacts): YouTubeVideoFacts {
  return {
    title: storableTitle(facts.title),
    durationSec: storableDurationSec(facts.durationSec),
  };
}
