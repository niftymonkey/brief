import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFramesPipeline, type FramesAdapters } from "./orchestrator";
import type { DownloadAdapter, DownloadResult } from "./download";
import type { FfmpegAdapter } from "./ffmpeg";
import type { ClassifyResult, VisionClient, VisionDescribeResult } from "./vision";
import type { TranscriptEntry } from "../types";
import type { FramesOptions } from "./types";

// --- stub adapters ------------------------------------------------------

interface StubDownloadConfig {
  result?: DownloadResult;
  available?: boolean;
  throws?: Error;
}

function stubDownload(config: StubDownloadConfig = {}): DownloadAdapter & {
  calls: { videoId: string; workDir: string }[];
} {
  const calls: { videoId: string; workDir: string }[] = [];
  return {
    calls,
    isAvailable: () => config.available ?? true,
    async download(videoId, workDir) {
      calls.push({ videoId, workDir });
      if (config.throws) throw config.throws;
      return (
        config.result ?? {
          kind: "ok" as const,
          videoPath: join(workDir, `${videoId}.mp4`),
          infoPath: join(workDir, `${videoId}.info.json`),
          durationSec: 120,
        }
      );
    },
  };
}

interface StubFfmpegConfig {
  scenes?: number[];
  detectScenesThrows?: Error;
  extractFrameThrows?: Error;
  available?: boolean;
}

function stubFfmpeg(config: StubFfmpegConfig = {}): FfmpegAdapter & {
  detectCalls: number;
  extractCalls: { videoPath: string; timestamp: number; outPath: string }[];
} {
  const extractCalls: { videoPath: string; timestamp: number; outPath: string }[] = [];
  let detectCalls = 0;
  return {
    isAvailable: () => config.available ?? true,
    get detectCalls() {
      return detectCalls;
    },
    extractCalls,
    async detectScenes() {
      detectCalls++;
      if (config.detectScenesThrows) throw config.detectScenesThrows;
      return config.scenes ?? [10, 30, 60];
    },
    async extractFrameAt(videoPath, timestamp, outPath) {
      extractCalls.push({ videoPath, timestamp, outPath });
      if (config.extractFrameThrows) throw config.extractFrameThrows;
    },
  };
}

interface StubVisionConfig {
  classifyResult?: ClassifyResult | ((framePath: string) => ClassifyResult);
  describeResult?: VisionDescribeResult | ((framePath: string) => VisionDescribeResult);
  classifyThrows?: Error;
  describeThrows?: Error;
  classifierModel?: string;
  visionModel?: string;
}

function stubVision(config: StubVisionConfig = {}): VisionClient & {
  classifyCalls: string[];
  describeCalls: string[];
} {
  const classifyCalls: string[] = [];
  const describeCalls: string[] = [];
  return {
    classifyCalls,
    describeCalls,
    classifierModel: config.classifierModel ?? "stub-classifier",
    visionModel: config.visionModel ?? "stub-vision",
    async classify(framePath) {
      classifyCalls.push(framePath);
      if (config.classifyThrows) throw config.classifyThrows;
      const r = config.classifyResult;
      if (typeof r === "function") return r(framePath);
      return r ?? { verdict: "yes", inputTokens: 100, outputTokens: 1 };
    },
    async describe(framePath) {
      describeCalls.push(framePath);
      if (config.describeThrows) throw config.describeThrows;
      const r = config.describeResult;
      if (typeof r === "function") return r(framePath);
      return (
        r ?? {
          description: `[stub] description of ${framePath}`,
          inputTokens: 500,
          outputTokens: 80,
        }
      );
    },
  };
}

// --- fixtures + helpers -------------------------------------------------

const sampleTranscript: TranscriptEntry[] = [
  { offsetSec: 0, durationSec: 5, text: "Welcome to the show" },
  { offsetSec: 5, durationSec: 5, text: "Right here you can see the dashboard" },
  { offsetSec: 30, durationSec: 5, text: "Let me show you the config" },
];

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "frames-orch-test-"));
});

afterEach(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function buildOpts(overrides: Partial<FramesOptions> = {}): FramesOptions {
  return {
    videoId: "abc123",
    transcript: sampleTranscript,
    openRouterApiKey: "stub-key",
    workDir,
    ...overrides,
  };
}

function buildAdapters(
  overrides: Partial<{
    download: ReturnType<typeof stubDownload>;
    ffmpeg: ReturnType<typeof stubFfmpeg>;
    vision: ReturnType<typeof stubVision>;
  }> = {},
): FramesAdapters {
  return {
    download: overrides.download ?? stubDownload(),
    ffmpeg: overrides.ffmpeg ?? stubFfmpeg(),
    vision: overrides.vision ?? stubVision(),
  };
}

// --- phase sequencing ---------------------------------------------------

describe("runFramesPipeline — happy path", () => {
  it("returns kind=included with the woven augmented transcript when every phase succeeds", async () => {
    const result = await runFramesPipeline(buildOpts(), buildAdapters());
    expect(result.kind).toBe("included");
    if (result.kind === "included") {
      expect(result.transcript).toContain("[VISUAL]");
      expect(result.transcript).toContain("[stub] description of");
    }
  });

  it("calls download → ffmpeg.detectScenes → ffmpeg.extractFrameAt → vision.classify → vision.describe in order", async () => {
    const download = stubDownload();
    const ffmpeg = stubFfmpeg({ scenes: [15, 45] });
    const vision = stubVision();
    await runFramesPipeline(buildOpts(), { download, ffmpeg, vision });

    expect(download.calls).toHaveLength(1);
    expect(ffmpeg.detectCalls).toBe(1);
    expect(ffmpeg.extractCalls.length).toBeGreaterThan(0);
    expect(vision.classifyCalls.length).toBeGreaterThan(0);
    // vision.describe is only called for `yes` classifications — count matches
    expect(vision.describeCalls.length).toBe(vision.classifyCalls.length);
  });

  it("aggregates token counts and verdict tallies across the run", async () => {
    const vision = stubVision({
      classifyResult: { verdict: "yes", inputTokens: 100, outputTokens: 1 },
      describeResult: { description: "[stub]", inputTokens: 500, outputTokens: 80 },
    });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.kind).toBe("included");
    expect(result.metrics.classifierYes).toBeGreaterThan(0);
    expect(result.metrics.classifierNo).toBe(0);
    expect(result.metrics.visionCalls).toBe(result.metrics.classifierYes);
    expect(result.metrics.inputTokens).toBeGreaterThan(0);
    expect(result.metrics.outputTokens).toBeGreaterThan(0);
  });

  it("reports the stubbed model names back in FramesMetrics", async () => {
    const vision = stubVision({ classifierModel: "fast-tiny", visionModel: "vision-big" });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.metrics.classifierModel).toBe("fast-tiny");
    expect(result.metrics.visionModel).toBe("vision-big");
  });

  it("records videoDurationSec from the download result", async () => {
    const download = stubDownload({
      result: {
        kind: "ok",
        videoPath: join(workDir, "abc123.mp4"),
        infoPath: join(workDir, "abc123.info.json"),
        durationSec: 537,
      },
    });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ download }));
    expect(result.metrics.videoDurationSec).toBe(537);
  });

  it("skips describe entirely when every classifier verdict is no", async () => {
    const vision = stubVision({
      classifyResult: { verdict: "no", inputTokens: 80, outputTokens: 1 },
    });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.kind).toBe("included");
    expect(vision.describeCalls).toHaveLength(0);
    expect(result.metrics.classifierYes).toBe(0);
    expect(result.metrics.visionCalls).toBe(0);
  });
});

// --- failure-to-result translation -------------------------------------

describe("runFramesPipeline — error to FramesResult translation", () => {
  it("returns missing-system-dep when yt-dlp is unavailable (preflight)", async () => {
    const download = stubDownload({ available: false });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ download }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("missing-system-dep");
      expect(result.phase).toBe("preflight");
      expect(result.message).toMatch(/yt-dlp/);
    }
  });

  it("returns missing-system-dep when ffmpeg is unavailable (preflight)", async () => {
    const ffmpeg = stubFfmpeg({ available: false });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ ffmpeg }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("missing-system-dep");
      expect(result.message).toMatch(/ffmpeg/);
    }
  });

  it("surfaces download failure with phase=download and the adapter-reported reason", async () => {
    const download = stubDownload({
      result: { kind: "failed", reason: "download-blocked-bot-detection", message: "bot challenge" },
    });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ download }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.phase).toBe("download");
      expect(result.reason).toBe("download-blocked-bot-detection");
    }
  });

  it("returns ffmpeg-failed with phase=scene-detection when ffmpeg.detectScenes throws", async () => {
    const ffmpeg = stubFfmpeg({ detectScenesThrows: new Error("ffmpeg core dumped") });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ ffmpeg }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("ffmpeg-failed");
      expect(result.phase).toBe("scene-detection");
      expect(result.message).toMatch(/core dumped/);
    }
  });

  it("returns ffmpeg-failed with phase=extraction when extractFrameAt throws", async () => {
    const ffmpeg = stubFfmpeg({ extractFrameThrows: new Error("disk full") });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ ffmpeg }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("ffmpeg-failed");
      expect(result.phase).toBe("extraction");
    }
  });

  it("returns vision-failed with phase=classify when vision.classify throws", async () => {
    const vision = stubVision({ classifyThrows: new Error("openrouter 429") });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("vision-failed");
      expect(result.phase).toBe("classify");
    }
  });

  it("returns vision-failed with phase=vision when vision.describe throws", async () => {
    const vision = stubVision({ describeThrows: new Error("openrouter 500") });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("vision-failed");
      expect(result.phase).toBe("vision");
    }
  });

  it("returns budget-exceeded with phase=selection when candidates > maxCandidates", async () => {
    // Force a lot of scenes so the candidate count blows past the cap.
    const ffmpeg = stubFfmpeg({ scenes: Array.from({ length: 200 }, (_, i) => i * 0.1 + 1) });
    const result = await runFramesPipeline(
      buildOpts({ maxCandidates: 5 }),
      buildAdapters({ ffmpeg }),
    );
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("budget-exceeded");
      expect(result.phase).toBe("selection");
    }
  });

  it("always returns metrics, even on failure (partial telemetry is useful for iteration)", async () => {
    const vision = stubVision({ describeThrows: new Error("openrouter 500") });
    const result = await runFramesPipeline(buildOpts(), buildAdapters({ vision }));
    expect(result.kind).toBe("attempted-failed");
    expect(result.metrics).toBeDefined();
    expect(result.metrics.classifierYes).toBeGreaterThanOrEqual(0);
    expect(result.metrics.wallClockMs).toBeGreaterThanOrEqual(0);
  });
});

// --- cancellation -------------------------------------------------------

describe("runFramesPipeline — cancellation", () => {
  it("returns aborted with phase=preflight when signal is already aborted at start", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runFramesPipeline(
      buildOpts({ signal: controller.signal }),
      buildAdapters(),
    );
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("aborted");
      expect(result.phase).toBe("preflight");
    }
  });

  it("returns aborted with phase=download when signal aborts between download and scene-detection", async () => {
    const controller = new AbortController();
    const download = stubDownload();
    download.download = vi.fn(async (videoId: string, workDir: string) => {
      controller.abort();
      return {
        kind: "ok" as const,
        videoPath: join(workDir, `${videoId}.mp4`),
        infoPath: join(workDir, `${videoId}.info.json`),
        durationSec: 120,
      };
    });
    const result = await runFramesPipeline(
      buildOpts({ signal: controller.signal }),
      buildAdapters({ download }),
    );
    expect(result.kind).toBe("attempted-failed");
    if (result.kind === "attempted-failed") {
      expect(result.reason).toBe("aborted");
      expect(result.phase).toBe("download");
    }
  });
});
