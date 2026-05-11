import type { TranscriptEntry, TranscriptResult } from "./types";

export const SCHEMA_VERSION = "1.0.0";

/**
 * Output shapes for `formatTranscript`. Three consumers in mind:
 *
 * - `json` — programmatic. Structured envelope, schemaVersion, entries array.
 * - `timestamped` — LLM-friendly. `[M:SS] text` lines preserving offsets as
 *   anchors. Used by the digest prompt and any downstream LLM consumer.
 * - `prose` — human-readable. Continuous joined text, no timestamp anchors.
 *   Intended for CLI/document consumption.
 *
 * When visual frames are interleaved into the entries (the planned video-frames
 * feature), `timestamped` and `prose` both render them inline at their offsets;
 * `json` exposes them as additional entries. The public API stays the same.
 */
export type TranscriptFormat = "json" | "timestamped" | "prose";

export function formatTranscript(
  result: TranscriptResult,
  format: TranscriptFormat,
): string {
  switch (format) {
    case "json":
      return renderJson(result);
    case "timestamped":
      return renderTimestamped(result);
    case "prose":
      return renderProse(result);
  }
}

function renderProse(result: TranscriptResult): string {
  switch (result.kind) {
    case "ok":
      return joinEntryText(result.entries);
    case "pending":
      return `Transcript generation queued (jobId: ${result.jobId}, retryAfter: ${result.retryAfterSeconds}s)`;
    case "unavailable":
      return `Unavailable (${result.reason}): ${result.message}`;
    case "transient":
      return `Transient failure (${result.cause}): ${result.message}`;
  }
}

function renderTimestamped(result: TranscriptResult): string {
  switch (result.kind) {
    case "ok":
      return result.entries
        .map((e) => `[${formatOffset(e.offsetSec)}] ${e.text}`)
        .join("\n");
    case "pending":
    case "unavailable":
    case "transient":
      return renderProse(result);
  }
}

function renderJson(result: TranscriptResult): string {
  const base: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    status: result.kind,
    source: "source" in result ? result.source : null,
    video: {},
    transcript: null,
    job: null,
    message: defaultMessage(result),
  };

  if (result.kind === "ok") {
    base.transcript = {
      language: result.lang ?? null,
      text: joinEntryText(result.entries),
      entries: result.entries.map((e) => ({
        offsetSec: e.offsetSec,
        durationSec: e.durationSec,
        text: e.text,
      })),
    };
  } else if (result.kind === "pending") {
    base.job = { id: result.jobId, retryAfterSeconds: result.retryAfterSeconds };
  } else if (result.kind === "unavailable") {
    base.reason = result.reason;
  }

  return JSON.stringify(base, null, 2);
}

function defaultMessage(result: TranscriptResult): string {
  switch (result.kind) {
    case "ok":
      return `Retrieved ${result.entries.length} transcript entries from ${result.source}`;
    case "pending":
    case "unavailable":
    case "transient":
      return result.message;
  }
}

function joinEntryText(entries: TranscriptEntry[]): string {
  return entries
    .map((e) => e.text.replace(/\s*\n\s*/g, " ").trim())
    .filter((t) => t.length > 0)
    .join(" ");
}

/**
 * Format a seconds offset as `M:SS`. Used as the timestamp anchor in
 * `timestamped` mode. Matches the convention the digest prompt was tuned on;
 * minutes are not zero-padded so a 2-hour video reads `120:30` rather than
 * `02:00:30`.
 */
function formatOffset(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
