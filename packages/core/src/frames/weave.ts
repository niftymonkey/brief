import type { TranscriptEntry } from "../types";
import type { Candidate } from "./selection";

const TRANSCRIPT_CHUNK_MAX_ENTRIES = 4;
const TRANSCRIPT_CHUNK_MAX_SPAN_S = 12;

/**
 * Interleave the speech transcript with the captured visual descriptions in
 * timestamp order. Output is the augmented string fed to the digest LLM.
 *
 * Speech entries are bucketed into ~12-second chunks (or 4 entries, whichever
 * comes first) so the LLM sees coherent paragraphs rather than one line per
 * caption. Visual descriptions break the chunking — anytime a visual lands
 * between two transcript entries, the in-flight speech buffer flushes first
 * so the `[VISUAL]` block appears at the right point in the narrative.
 *
 * Visual text has markdown emphasis stripped (`**bold**`, `*italic*`, `_x_`)
 * because the augmented stream is itself markdown-ish and those markers add
 * no semantic value. Newlines, indentation, and code fences are preserved —
 * verbatim content (system prompts, config files, code) is the highest-value
 * output and depends on structural formatting.
 */
export function weave(transcript: TranscriptEntry[], candidates: Candidate[]): string {
  const visuals = candidates
    .filter((c): c is Candidate & { vision: NonNullable<Candidate["vision"]> } =>
      Boolean(c.vision?.description),
    )
    .map((c) => ({ type: "visual" as const, t: c.t, text: c.vision.description }));

  const speech = transcript.map((e) => ({
    type: "transcript" as const,
    t: e.offsetSec,
    end: e.offsetSec + e.durationSec,
    text: e.text,
  }));

  const all = [...speech, ...visuals].sort((a, b) => a.t - b.t);

  const lines: string[] = [];
  let buffer: Array<typeof speech[number]> = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    const start = buffer[0].t;
    const end = buffer[buffer.length - 1].end;
    const text = buffer.map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
    lines.push(`[${fmtTime(start)}-${fmtTime(end)}] ${text}`);
    lines.push("");
    buffer = [];
  };

  for (const ev of all) {
    if (ev.type === "transcript") {
      buffer.push(ev);
      if (
        buffer.length >= TRANSCRIPT_CHUNK_MAX_ENTRIES ||
        ev.end - buffer[0].t > TRANSCRIPT_CHUNK_MAX_SPAN_S
      ) {
        flush();
      }
    } else {
      flush();
      lines.push(`[${fmtTime(ev.t)}] [VISUAL] ${stripEmphasisOutsideCodeFences(ev.text).trim()}`);
      lines.push("");
    }
  }
  flush();

  return lines.join("\n");
}

/**
 * Strips markdown emphasis (`**bold**`, `*italic*`, `_x_`) from prose segments
 * but leaves fenced code blocks untouched. VERBATIM-mode vision results can
 * contain code, config, or prompt templates where `*` and `_` are syntactically
 * meaningful (e.g., glob patterns, snake_case identifiers); stripping them
 * would corrupt copy-pasteable content. We split on the fenced-block delimiter
 * and only sanitize segments that aren't a fence.
 */
function stripEmphasisOutsideCodeFences(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part) =>
      part.startsWith("```")
        ? part
        : part
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, "$1")
            .replace(/_([^_\n]+)_/g, "$1"),
    )
    .join("");
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
