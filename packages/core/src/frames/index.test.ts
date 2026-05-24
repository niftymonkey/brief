import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFramesPipeline, type FramesAdapters } from "./orchestrator";
import type { DownloadAdapter, DownloadResult } from "./download";
import type { FfmpegAdapter } from "./ffmpeg";
import type { ClassifyResult, VisionClient, VisionDescribeResult } from "./vision";
import type { TranscriptEntry } from "../types";

/**
 * Public-surface contract tests. These exercise `runFramesPipeline` (which
 * `extractFrames` thinly wraps with production adapters) to lock down the
 * caller-visible behavior:
 *
 * - happy path returns kind=included with a non-empty augmented transcript
 *   and metrics that account for the run.
 * - candidate overflow downsamples to the cap rather than failing. The
 *   `--with-frames` opt-in is expensive, so silently demoting to transcript-
 *   only would defeat it. Metrics carry `candidatesAfterDownsample` to make
 *   the trim visible.
 *
 * Other failure modes (download / scene / extraction / classify / vision)
 * have full coverage at the orchestrator level in orchestrator.test.ts.
 */

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "frames-contract-test-"));
});

afterEach(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function okDownload(): DownloadAdapter {
  return {
    isAvailable: () => true,
    async download(videoId, dir) {
      return {
        kind: "ok",
        videoPath: join(dir, `${videoId}.mp4`),
        infoPath: join(dir, `${videoId}.info.json`),
        durationSec: 200,
      } satisfies DownloadResult;
    },
  };
}

function okFfmpeg(scenes: number[] = [10, 25, 60, 90, 150]): FfmpegAdapter {
  return {
    isAvailable: () => true,
    async detectScenes() {
      return scenes;
    },
    async extractFrameAt() {
      // No-op stub; orchestrator just needs the call to succeed.
    },
  };
}

function okVision(): VisionClient {
  return {
    classifierModel: "stub-classifier",
    visionModel: "stub-vision",
    async classify(_framePath): Promise<ClassifyResult> {
      return { verdict: "yes", inputTokens: 120, outputTokens: 1 };
    },
    async describe(framePath): Promise<VisionDescribeResult> {
      return {
        description: `[Slide ${framePath.split("/").pop()}] verbatim content`,
        inputTokens: 600,
        outputTokens: 90,
      };
    },
  };
}

const sampleTranscript: TranscriptEntry[] = [
  { offsetSec: 0, durationSec: 5, text: "Intro" },
  { offsetSec: 5, durationSec: 5, text: "Right here you can see the result" },
  { offsetSec: 30, durationSec: 5, text: "Body of the talk" },
];

describe("extractFrames public contract", () => {
  it("happy path: returns kind=included with augmented transcript + non-zero metrics", async () => {
    const adapters: FramesAdapters = {
      download: okDownload(),
      ffmpeg: okFfmpeg(),
      vision: okVision(),
    };
    const result = await runFramesPipeline(
      {
        videoId: "abc123",
        transcript: sampleTranscript,
        openRouterApiKey: "stub",
        workDir,
      },
      adapters,
    );

    expect(result.kind).toBe("included");
    if (result.kind === "included") {
      expect(result.transcript).toContain("[VISUAL]");
      expect(result.metrics.candidatesAfterDedup).toBeGreaterThan(0);
      expect(result.metrics.visionCalls).toBeGreaterThan(0);
      expect(result.metrics.inputTokens).toBeGreaterThan(0);
      expect(result.metrics.outputTokens).toBeGreaterThan(0);
      expect(result.metrics.wallClockMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.costSource).toBe("cli-reported");
    }
  });

  it("candidate overflow: downsamples to the cap and still returns included", async () => {
    // Way more scenes than the cap allows, well-separated so dedup keeps them.
    // Every other adapter succeeds; selection should trim, not abort.
    const adapters: FramesAdapters = {
      download: okDownload(),
      ffmpeg: okFfmpeg(Array.from({ length: 200 }, (_, i) => i * 5 + 5)),
      vision: okVision(),
    };

    const result = await runFramesPipeline(
      {
        videoId: "abc123",
        transcript: sampleTranscript,
        openRouterApiKey: "stub",
        workDir,
        maxCandidates: 5,
      },
      adapters,
    );

    expect(result.kind).toBe("included");
    if (result.kind === "included") {
      expect(result.metrics.candidatesAfterDedup).toBeGreaterThan(5);
      expect(result.metrics.candidatesAfterDownsample).toBe(5);
      expect(result.metrics.visionCalls).toBe(result.metrics.candidatesAfterDownsample);
    }
  });
});
