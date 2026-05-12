import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadAdapter } from "./download";
import { extractAllFrames, type FfmpegAdapter } from "./ffmpeg";
import { selectCandidates, type Candidate } from "./selection";
import type { VisionClient } from "./vision";
import { weave } from "./weave";
import type {
  FramesFailReason,
  FramesMetrics,
  FramesOptions,
  FramesPhase,
  FramesResult,
} from "./types";

const DEFAULT_MAX_CANDIDATES = 100;
const SCENE_THRESHOLD = 0.2;
const CLASSIFIER_CONCURRENCY = 5;
const VISION_CONCURRENCY = 4;

export interface FramesAdapters {
  download: DownloadAdapter;
  ffmpeg: FfmpegAdapter;
  vision: VisionClient;
}

/**
 * Sequences the 8-phase video-frames pipeline. Each phase reports failures as
 * a `FramesResult.attempted-failed` discriminator with a `phase` tag so the
 * caller knows which step regressed. Metrics accumulate as the run proceeds
 * and are returned on both success and failure paths.
 *
 * Adapters are injected so Phase 4's integration tests can stub the external
 * surfaces (yt-dlp, ffmpeg, OpenRouter) without touching real subprocesses or
 * the network.
 */
export async function runFramesPipeline(
  opts: FramesOptions,
  adapters: FramesAdapters,
): Promise<FramesResult> {
  const startedAt = Date.now();
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const metrics: FramesMetrics = {
    videoDurationSec: 0,
    candidatesGenerated: 0,
    candidatesAfterDedup: 0,
    classifierYes: 0,
    classifierNo: 0,
    visionCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    classifierModel: adapters.vision.classifierModel,
    visionModel: adapters.vision.visionModel,
    wallClockMs: 0,
    costSource: "cli-reported",
  };

  const finalize = (
    failure: { reason: FramesFailReason; phase: FramesPhase; message: string } | null,
    transcriptOut?: string,
  ): FramesResult => {
    metrics.wallClockMs = Date.now() - startedAt;
    if (failure) {
      return {
        kind: "attempted-failed",
        reason: failure.reason,
        phase: failure.phase,
        message: failure.message,
        metrics,
      };
    }
    return { kind: "included", transcript: transcriptOut ?? "", metrics };
  };

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "preflight", message: "Aborted before start." });
  }

  // Preflight: bail early if either local binary is missing so we don't spend
  // any time on a run that's guaranteed to fail at first subprocess.
  if (!adapters.download.isAvailable()) {
    return finalize({
      reason: "missing-system-dep",
      phase: "preflight",
      message: "Required CLI tool 'yt-dlp' not found on PATH. Install yt-dlp (https://github.com/yt-dlp/yt-dlp) and try again.",
    });
  }
  if (!adapters.ffmpeg.isAvailable()) {
    return finalize({
      reason: "missing-system-dep",
      phase: "preflight",
      message: "Required CLI tool 'ffmpeg' not found on PATH. Install ffmpeg (https://ffmpeg.org/) and try again.",
    });
  }

  mkdirSync(opts.workDir, { recursive: true });
  const framesDir = resolve(opts.workDir, "frames");
  mkdirSync(framesDir, { recursive: true });

  // ---------- phase: download ----------
  const downloadResult = await adapters.download.download(opts.videoId, opts.workDir);
  if (downloadResult.kind === "failed") {
    return finalize({
      reason: downloadResult.reason,
      phase: "download",
      message: downloadResult.message,
    });
  }
  metrics.videoDurationSec = downloadResult.durationSec;

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "download", message: "Aborted after download." });
  }

  // ---------- phase: scene-detection ----------
  let scenes: number[];
  try {
    scenes = await adapters.ffmpeg.detectScenes(downloadResult.videoPath, SCENE_THRESHOLD);
  } catch (err) {
    return finalize({
      reason: "ffmpeg-failed",
      phase: "scene-detection",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ---------- phase: selection ----------
  const { candidates, candidatesGenerated } = selectCandidates({
    scenes,
    chapters: opts.chapters ?? [],
    transcript: opts.transcript,
    durationSec: downloadResult.durationSec,
  });
  metrics.candidatesGenerated = candidatesGenerated;
  metrics.candidatesAfterDedup = candidates.length;

  if (candidates.length > maxCandidates) {
    return finalize({
      reason: "budget-exceeded",
      phase: "selection",
      message: `Candidate count ${candidates.length} exceeds cap ${maxCandidates}.`,
    });
  }

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "selection", message: "Aborted before extraction." });
  }

  // ---------- phase: extraction ----------
  try {
    await extractAllFrames(candidates, downloadResult.videoPath, framesDir, adapters.ffmpeg);
  } catch (err) {
    return finalize({
      reason: "ffmpeg-failed",
      phase: "extraction",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ---------- phase: classify ----------
  try {
    await runWithConcurrency(candidates, CLASSIFIER_CONCURRENCY, async (c) => {
      if (opts.signal?.aborted || !c.frame) return;
      const result = await adapters.vision.classify(resolve(framesDir, c.frame), opts.signal);
      c.classification = { verdict: result.verdict };
      if (result.verdict === "yes") metrics.classifierYes++;
      else metrics.classifierNo++;
      metrics.inputTokens += result.inputTokens;
      metrics.outputTokens += result.outputTokens;
    });
  } catch (err) {
    return finalize({
      reason: "vision-failed",
      phase: "classify",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "classify", message: "Aborted before vision pass." });
  }

  // ---------- phase: vision ----------
  const yesFrames = candidates.filter((c) => c.classification?.verdict === "yes");
  try {
    await runWithConcurrency(yesFrames, VISION_CONCURRENCY, async (c) => {
      if (opts.signal?.aborted || !c.frame) return;
      const result = await adapters.vision.describe(resolve(framesDir, c.frame), opts.signal);
      c.vision = {
        description: result.description,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
      metrics.visionCalls++;
      metrics.inputTokens += result.inputTokens;
      metrics.outputTokens += result.outputTokens;
    });
  } catch (err) {
    return finalize({
      reason: "vision-failed",
      phase: "vision",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ---------- phase: weave ----------
  const woven = weave(opts.transcript, candidates);
  return finalize(null, woven);
}

/**
 * Bounded-concurrency map. Workers pull from a shared cursor; once items are
 * exhausted each worker exits. Throws propagate to the caller — used by the
 * orchestrator to turn the first failed LLM call into an `attempted-failed`.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// Re-export Candidate for adapter authors who want to inspect the orchestrator
// inputs in tests; consumers of the public surface stay on `FramesResult`.
export type { Candidate };
