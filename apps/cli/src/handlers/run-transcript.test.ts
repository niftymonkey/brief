import { describe, it, expect, vi } from "vitest";
import type { FramesResult, MetadataResult, TranscriptResult } from "@brief/core";
import { runTranscript, type RunTranscriptDeps } from "./run-transcript";

const okTranscript: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  entries: [
    { offsetSec: 0, durationSec: 2.5, text: "Hello world" },
    { offsetSec: 2.5, durationSec: 3, text: "How are you" },
  ],
};

const unavailableTranscript: TranscriptResult = {
  kind: "unavailable",
  reason: "no-captions",
  message: "No captions available",
};

const transientTranscript: TranscriptResult = {
  kind: "transient",
  cause: "timeout",
  message: "Upstream timed out",
};

const pendingTranscript: TranscriptResult = {
  kind: "pending",
  source: "supadata",
  jobId: "job_01",
  retryAfterSeconds: 30,
  message: "Async generation queued",
};

const okMetadata: MetadataResult = {
  kind: "ok",
  metadata: {
    videoId: "abc123XYZAB",
    title: "Test video",
    channelTitle: "Test channel",
    channelId: "UC_abc",
    duration: "PT1M",
    publishedAt: "2024-01-01T00:00:00Z",
    description: "",
  },
};

function makeDeps(overrides: Partial<RunTranscriptDeps> = {}): RunTranscriptDeps {
  return {
    fetchTranscript: vi.fn().mockResolvedValue(okTranscript),
    fetchMetadata: vi.fn().mockResolvedValue(okMetadata),
    ...overrides,
  };
}

describe("runTranscript", () => {
  it("returns exit code 0 with transcript text on stdout (human format)", async () => {
    const deps = makeDeps();
    const result = await runTranscript(deps, {
      input: "abc123XYZAB",
      json: false,
      noMetadata: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello world");
  });

  it("emits parseable JSON when json:true is set", async () => {
    const deps = makeDeps();
    const result = await runTranscript(deps, {
      input: "abc123XYZAB",
      json: true,
      noMetadata: false,
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("ok");
  });

  it("skips metadata fetch when noMetadata:true is set", async () => {
    const deps = makeDeps();
    await runTranscript(deps, {
      input: "abc123XYZAB",
      json: false,
      noMetadata: true,
    });
    expect(deps.fetchMetadata).not.toHaveBeenCalled();
  });

  it("returns exit code 3 when transcript is unavailable", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue(unavailableTranscript),
    });
    const result = await runTranscript(deps, {
      input: "abc",
      json: false,
      noMetadata: true,
    });
    expect(result.exitCode).toBe(3);
  });

  it("returns exit code 4 on transient transcript failures", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue(transientTranscript),
    });
    const result = await runTranscript(deps, {
      input: "abc",
      json: false,
      noMetadata: true,
    });
    expect(result.exitCode).toBe(4);
  });

  it("returns exit code 2 on pending async-generation", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue(pendingTranscript),
    });
    const result = await runTranscript(deps, {
      input: "abc",
      json: false,
      noMetadata: true,
    });
    expect(result.exitCode).toBe(2);
  });

  it("emits a one-line stderr tip when invoked via bare-positional shortcut", async () => {
    const deps = makeDeps();
    const result = await runTranscript(deps, {
      input: "abc",
      json: false,
      noMetadata: true,
      bareShortcut: true,
    });
    expect(result.stderr).toMatch(/brief transcript/i);
  });

  it("does not emit the shortcut tip when invoked via explicit subcommand", async () => {
    const deps = makeDeps();
    const result = await runTranscript(deps, {
      input: "abc",
      json: false,
      noMetadata: true,
      bareShortcut: false,
    });
    expect(result.stderr).not.toMatch(/brief transcript/i);
  });
});

describe("runTranscript with --with-frames", () => {
  const sampleMetrics = {
    videoDurationSec: 210,
    candidatesGenerated: 50,
    candidatesAfterDedup: 30,
    classifierYes: 10,
    classifierNo: 20,
    visionCalls: 10,
    visionVerbatim: 3,
    visionSummary: 7,
    inputTokens: 1000,
    outputTokens: 500,
    classifierModel: "openai/gpt-5.4-nano",
    visionModel: "openai/gpt-5.5",
    wallClockMs: 12345,
    phasesMs: {},
    costSource: "cli-reported" as const,
  };

  it("returns ARG_ERROR when withFrames is set but no OpenRouter key is supplied", async () => {
    const deps = makeDeps({ extractFrames: vi.fn() });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/OPENROUTER_API_KEY/);
    expect(deps.extractFrames).not.toHaveBeenCalled();
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
  });

  it("writes the augmented transcript to stdout on a successful frames run", async () => {
    const augmented = "[0:00-0:05] Hello world\n\n[0:05] [VISUAL] Pricing: $19/mo\n";
    const framesResult: FramesResult = {
      kind: "included",
      transcript: augmented,
      metrics: sampleMetrics,
    };
    const extractFrames = vi.fn().mockResolvedValue(framesResult);
    const deps = makeDeps({ extractFrames });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: true,
      openRouterKey: "sk-or-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[VISUAL]");
    expect(result.stdout).toContain("Pricing: $19/mo");
  });

  it("falls back to speech-only stdout with a stderr note when frames pipeline returns attempted-failed", async () => {
    const failedResult: FramesResult = {
      kind: "attempted-failed",
      reason: "download-failed",
      phase: "download",
      message: "Network unreachable",
      metrics: sampleMetrics,
    };
    const extractFrames = vi.fn().mockResolvedValue(failedResult);
    const deps = makeDeps({ extractFrames });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: true,
      openRouterKey: "sk-or-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello world");
    expect(result.stdout).not.toContain("[VISUAL]");
    expect(result.stderr).toMatch(/frames pipeline failed.*download-failed/i);
  });

  it("does not invoke the frames pipeline when withFrames is false (cost guard)", async () => {
    const extractFrames = vi.fn();
    const deps = makeDeps({ extractFrames });
    await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: false,
      openRouterKey: "sk-or-test",
    });
    expect(extractFrames).not.toHaveBeenCalled();
  });

  it("does not invoke the frames pipeline when transcript fetch fails", async () => {
    const extractFrames = vi.fn();
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue(unavailableTranscript),
      extractFrames,
    });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: true,
      openRouterKey: "sk-or-test",
    });
    expect(result.exitCode).toBe(3);
    expect(extractFrames).not.toHaveBeenCalled();
  });

  it("falls back to speech-only when extractFrames itself throws (defense in depth)", async () => {
    const extractFrames = vi.fn().mockRejectedValue(new Error("yt-dlp segfault"));
    const deps = makeDeps({ extractFrames });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: false,
      noMetadata: true,
      withFrames: true,
      openRouterKey: "sk-or-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello world");
    expect(result.stderr).toMatch(/yt-dlp segfault/);
  });

  it("falls through to standard JSON output when withFrames is set with --json (frames not woven into structured form)", async () => {
    const extractFrames = vi.fn();
    const deps = makeDeps({ extractFrames });
    const result = await runTranscript(deps, {
      input: "dQw4w9WgXcQ",
      json: true,
      noMetadata: true,
      withFrames: true,
      openRouterKey: "sk-or-test",
    });
    expect(result.exitCode).toBe(0);
    // JSON format short-circuits before extractFrames runs; the structured shape
    // doesn't (yet) carry [VISUAL] entries — that's chunk-8 territory.
    expect(extractFrames).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("ok");
  });
});
