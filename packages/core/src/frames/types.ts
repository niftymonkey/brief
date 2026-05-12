import type { TranscriptEntry } from "../types";
import type { Chapter } from "./selection";

/**
 * Public surface for the video-frames pipeline. All types consumers depend on
 * live here — adapters and orchestrator share them but never re-define them.
 */
export interface FramesOptions {
  videoId: string;
  transcript: TranscriptEntry[];
  chapters?: Chapter[] | null;
  openRouterApiKey: string;
  workDir: string;
  maxCandidates?: number;
  signal?: AbortSignal;
}

export type FramesResult =
  | { kind: "included"; transcript: string; metrics: FramesMetrics }
  | {
      kind: "attempted-failed";
      reason: FramesFailReason;
      phase: FramesPhase;
      message: string;
      metrics: FramesMetrics;
    };

export type FramesFailReason =
  | "missing-system-dep"
  | "download-blocked-bot-detection"
  | "video-not-public"
  | "download-failed"
  | "ffmpeg-failed"
  | "vision-failed"
  | "budget-exceeded"
  | "aborted"
  | "unknown";

export type FramesPhase =
  | "preflight"
  | "download"
  | "scene-detection"
  | "selection"
  | "extraction"
  | "classify"
  | "vision"
  | "weave";

export interface FramesMetrics {
  videoDurationSec: number;
  candidatesGenerated: number;
  candidatesAfterDedup: number;
  classifierYes: number;
  classifierNo: number;
  visionCalls: number;
  /** Vision results that came back as VERBATIM mode (code, prompts, configs reproduced word-for-word). */
  visionVerbatim: number;
  /** Vision results that came back as SUMMARY mode (slides, diagrams, paragraph descriptions). */
  visionSummary: number;
  inputTokens: number;
  outputTokens: number;
  classifierModel: string;
  visionModel: string;
  /** Total wall-clock duration of the run, including failures. */
  wallClockMs: number;
  /** Per-phase wall-clock breakdown so cost/latency hotspots are visible without re-running. */
  phasesMs: Partial<Record<FramesPhase, number>>;
  costSource: "cli-reported";
}
