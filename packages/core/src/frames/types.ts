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
  inputTokens: number;
  outputTokens: number;
  classifierModel: string;
  visionModel: string;
  wallClockMs: number;
  costSource: "cli-reported";
}
