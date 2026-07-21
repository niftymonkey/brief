import { extractVideoId } from "@brief/core/parser";

export interface ParsedItemInput {
  videoId: string;
  startSec: number | null;
  endSec: number | null;
}

export type ParseItemResult =
  | { ok: true; value: ParsedItemInput }
  | { ok: false; error: string };

function parseOptionalSeconds(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return "invalid";
  return value;
}

/**
 * Parses the add/swap item form: a pasted YouTube URL (any form core accepts,
 * including Shorts) plus optional whole-second start/end bounds. Returns the bare
 * videoId the items API expects, or a human-readable error.
 */
export function parseItemInput(
  url: string,
  startRaw: string,
  endRaw: string,
): ParseItemResult {
  const videoId = extractVideoId(url.trim());
  if (!videoId) {
    return { ok: false, error: "Enter a valid YouTube URL." };
  }

  const startSec = parseOptionalSeconds(startRaw);
  if (startSec === "invalid") {
    return { ok: false, error: "Start must be a whole number of seconds." };
  }

  const endSec = parseOptionalSeconds(endRaw);
  if (endSec === "invalid") {
    return { ok: false, error: "End must be a whole number of seconds." };
  }

  if (startSec !== null && endSec !== null && endSec <= startSec) {
    return { ok: false, error: "End must come after start." };
  }

  return { ok: true, value: { videoId, startSec, endSec } };
}
