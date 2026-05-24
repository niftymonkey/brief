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

/**
 * Trim a candidate list down to `cap` items while preserving the highest-
 * signal sources and even time coverage. Used as a soft target instead of a
 * hard failure when selection produces more candidates than the budget allows.
 *
 * Strategy: walk priority tiers from highest to lowest. Include each tier
 * whole until adding the next would overflow the cap; then evenly sample that
 * tier across time to fill the remaining slots. Lower-priority tiers are
 * dropped entirely. This keeps every chapter-start and transcript cue when
 * scene-changes dominate (the common case on long technical videos) and
 * degrades gracefully when even the high-priority sources blow the cap.
 */
export function downsampleCandidates(candidates: Candidate[], cap: number): Candidate[] {
  if (cap <= 0) return [];
  if (candidates.length <= cap) return candidates;

  const tiers = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const p = priority(c.source);
    const existing = tiers.get(p);
    if (existing) existing.push(c);
    else tiers.set(p, [c]);
  }
  const sortedTiers = [...tiers.entries()].sort((a, b) => b[0] - a[0]);

  const selected: Candidate[] = [];
  let remaining = cap;
  for (const [, items] of sortedTiers) {
    if (items.length <= remaining) {
      selected.push(...items);
      remaining -= items.length;
      if (remaining === 0) break;
      continue;
    }
    const byTime = [...items].sort((a, b) => a.t - b.t);
    const k = remaining;
    const n = byTime.length;
    if (k === 1) {
      selected.push(byTime[Math.floor((n - 1) / 2)]);
    } else {
      for (let i = 0; i < k; i++) {
        const idx = Math.round((i * (n - 1)) / (k - 1));
        selected.push(byTime[idx]);
      }
    }
    remaining = 0;
    break;
  }
  selected.sort((a, b) => a.t - b.t);
  return selected;
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
