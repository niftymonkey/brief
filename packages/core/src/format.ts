import type { TranscriptResult } from "./types";

export const SCHEMA_VERSION = "1.0.0";

export type TranscriptFormat = "text" | "json";

export function formatTranscript(
  result: TranscriptResult,
  format: TranscriptFormat
): string {
  return format === "text" ? renderText(result) : renderJson(result);
}

function renderText(result: TranscriptResult): string {
  switch (result.kind) {
    case "ok":
      return result.entries
        .map((e) => `[${formatTimestamp(e.offsetSec)}] ${e.text}`)
        .join("\n");
    case "pending":
      return `Transcript generation queued (jobId: ${result.jobId}, retryAfter: ${result.retryAfterSeconds}s)`;
    case "unavailable":
      return `Unavailable (${result.reason}): ${result.message}`;
    case "transient":
      return `Transient failure (${result.cause}): ${result.message}`;
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

function joinEntryText(
  entries: { text: string }[]
): string {
  return entries.map((e) => e.text.replace(/\s*\n\s*/g, " ")).join("\n");
}

function formatTimestamp(totalSec: number): string {
  const total = Math.floor(totalSec);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  }
  return `${String(minutes).padStart(2, "0")}:${ss}`;
}
