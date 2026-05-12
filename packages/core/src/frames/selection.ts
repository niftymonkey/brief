import type { TranscriptEntry } from "../types";

export interface Chapter {
  title: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * One timestamp the pipeline wants a frame from, plus where the suggestion
 * came from. Sources are kept human-readable so failures and metrics can
 * point at the heuristic that produced them.
 */
export interface Candidate {
  t: number;
  source: string;
  frame?: string;
  classification?: { verdict: "yes" | "no" | "error" };
  vision?: { description: string; inputTokens: number; outputTokens: number };
}

export interface SelectionInput {
  scenes: number[];
  chapters: Chapter[];
  transcript: TranscriptEntry[];
  durationSec: number;
}

export interface SelectionResult {
  candidates: Candidate[];
  candidatesGenerated: number;
}

export const DEDUP_WINDOW_S = 3;
export const CHAPTER_INTERIOR_RATIOS = [0.33, 0.67] as const;

/**
 * Verbal "show-me" cue phrases that hint the speaker just put something on
 * screen. Case-insensitive. False positives are fine — the downstream
 * classifier filters them out before the expensive vision call.
 */
export const TRANSCRIPT_CUE_PATTERNS: RegExp[] = [
  /\bright here\b/i,
  /\bas you can see\b/i,
  /\byou can see\b/i,
  /\blet me show\b/i,
  /\bi'?ll show you\b/i,
  /\bhere'?s (the|a|my|how|what|where)\b/i,
  /\blook at (this|the|how|what)\b/i,
  /\bthis is (the|a|my|what|how|where)\b/i,
  /\bwatch this\b/i,
  /\b(i'?m|i'?ll|let me) (pull|pulling|open|opening) up\b/i,
  /\bsee how\b/i,
  /\bcheck (this|out)\b/i,
  /\bover here\b/i,
];

/**
 * When multiple candidates collapse into the same dedup window, the
 * higher-priority source wins. Tracks which heuristic we trust more when
 * scene-change and chapter-start (etc.) happen to fall within 3 seconds.
 */
function priority(source: string): number {
  if (source.startsWith("chapter-start")) return 4;
  if (source.startsWith("transcript-cue:")) return 3;
  if (source.startsWith("transcript-cue-after:")) return 3;
  if (source === "scene-change") return 2;
  if (source.startsWith("chapter-interior")) return 1;
  return 0;
}

export function selectCandidates(input: SelectionInput): SelectionResult {
  const { scenes, chapters, transcript, durationSec } = input;
  const sources: Candidate[] = [];

  for (const t of scenes) sources.push({ t, source: "scene-change" });
  for (const c of chapters) {
    sources.push({ t: c.startSeconds, source: `chapter-start:${c.title}` });
    for (const r of CHAPTER_INTERIOR_RATIOS) {
      const t = c.startSeconds + (c.endSeconds - c.startSeconds) * r;
      sources.push({ t, source: `chapter-interior:${c.title}@${Math.round(r * 100)}%` });
    }
  }
  for (const e of transcript) {
    for (const re of TRANSCRIPT_CUE_PATTERNS) {
      const m = e.text.match(re);
      if (m) {
        sources.push({ t: e.offsetSec, source: `transcript-cue:"${m[0]}"` });
        sources.push({ t: e.offsetSec + 3, source: `transcript-cue-after:"${m[0]}"+3s` });
        break;
      }
    }
  }
  sources.push({ t: 1, source: "video-start" });
  sources.sort((a, b) => a.t - b.t);

  const candidates: Candidate[] = [];
  for (const c of sources) {
    if (c.t < 0.5 || (durationSec > 0 && c.t > durationSec - 0.5)) continue;
    const last = candidates[candidates.length - 1];
    if (last && Math.abs(c.t - last.t) < DEDUP_WINDOW_S) {
      if (priority(c.source) > priority(last.source)) {
        candidates[candidates.length - 1] = c;
      }
    } else {
      candidates.push(c);
    }
  }

  return { candidates, candidatesGenerated: sources.length };
}
