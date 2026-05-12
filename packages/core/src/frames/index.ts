import { createYtDlpAdapter } from "./download";
import { createFfmpegAdapter } from "./ffmpeg";
import { createOpenRouterVisionClient } from "./vision";
import { runFramesPipeline, type FramesAdapters } from "./orchestrator";
import type { FramesOptions, FramesResult } from "./types";

/**
 * Public surface for the video-frames pipeline. Wires the production-default
 * adapters (yt-dlp, ffmpeg, OpenRouter) into the orchestrator and returns
 * whatever it computes. Callers that need to override an adapter (tests,
 * future server-issued-token variants) build their own `FramesAdapters` and
 * call `runFramesPipeline` directly.
 *
 * Failures from any phase downgrade to `attempted-failed` so the caller can
 * ship transcript-only output instead of crashing.
 */
export async function extractFrames(opts: FramesOptions): Promise<FramesResult> {
  const adapters: FramesAdapters = {
    download: createYtDlpAdapter(),
    ffmpeg: createFfmpegAdapter(),
    vision: createOpenRouterVisionClient({ apiKey: opts.openRouterApiKey }),
  };
  return runFramesPipeline(opts, adapters);
}

export type { Chapter } from "./selection";
export type {
  FramesFailReason,
  FramesMetrics,
  FramesOptions,
  FramesPhase,
  FramesResult,
} from "./types";
export { runFramesPipeline } from "./orchestrator";
export type { FramesAdapters } from "./orchestrator";
export type { DownloadAdapter, DownloadResult } from "./download";
export type { FfmpegAdapter } from "./ffmpeg";
export {
  type VisionClient,
  type ClassifyResult,
  type ClassifyVerdict,
  type VisionDescribeResult,
  CLASSIFIER_PROMPT,
  VISION_PROMPT,
} from "./vision";
