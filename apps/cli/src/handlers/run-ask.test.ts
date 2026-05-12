import { describe, it, expect, vi } from "vitest";
import type {
  AskVideoResult,
  FramesResult,
  TranscriptResult,
} from "@brief/core";
import { runAsk, type RunAskDeps, type RunAskOptions } from "./run-ask";

const okTranscript: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  entries: [
    { offsetSec: 0, durationSec: 5, text: "Hello world" },
    { offsetSec: 5, durationSec: 5, text: "Welcome to the show" },
  ],
};

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

const includedFrames: FramesResult = {
  kind: "included",
  transcript: "[0:00-0:05] Hello world\n\n[0:05] [VISUAL] Logo\n",
  metrics: sampleMetrics,
};

const okAnswer: AskVideoResult = {
  kind: "ok",
  answer: "The logo is shown at 0:05.",
  metrics: { inputTokens: 200, outputTokens: 30, model: "openai/gpt-5.5", latencyMs: 1000 },
};

function makeDeps(overrides: Partial<RunAskDeps> = {}): RunAskDeps {
  return {
    fetchTranscript: vi.fn().mockResolvedValue(okTranscript),
    extractFrames: vi.fn().mockResolvedValue(includedFrames),
    askVideo: vi.fn().mockResolvedValue(okAnswer),
    readStdin: vi.fn().mockResolvedValue(""),
    progress: vi.fn(),
    ...overrides,
  };
}

const baseUrl: RunAskOptions = {
  input: "dQw4w9WgXcQ",
  question: "What's the logo?",
  openRouterKey: "sk-test",
};

describe("runAsk — argument validation", () => {
  it("returns ARG_ERROR when the question is empty", async () => {
    const deps = makeDeps();
    const result = await runAsk(deps, { ...baseUrl, question: "  " });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/missing question/i);
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
  });

  it("URL mode: returns ARG_ERROR when no OpenRouter key is supplied", async () => {
    const deps = makeDeps();
    const result = await runAsk(deps, { ...baseUrl, openRouterKey: undefined });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/OPENROUTER_API_KEY/);
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
  });

  it("URL mode: returns ARG_ERROR when the input doesn't parse as a YouTube video", async () => {
    const deps = makeDeps();
    const result = await runAsk(deps, { ...baseUrl, input: "not a video" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Could not extract a YouTube video ID/);
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
  });

  it("stdin mode: returns ARG_ERROR when stdin is empty AND no input was given", async () => {
    const deps = makeDeps({ readStdin: vi.fn().mockResolvedValue("") });
    const result = await runAsk(deps, {
      question: "anything",
      openRouterKey: "sk-test",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Stdin is empty/);
    expect(deps.askVideo).not.toHaveBeenCalled();
  });

  it("stdin mode: returns ARG_ERROR when no OpenRouter key is supplied", async () => {
    const deps = makeDeps({ readStdin: vi.fn().mockResolvedValue("some transcript") });
    const result = await runAsk(deps, {
      question: "anything",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("runAsk — URL mode (idempotent prelude)", () => {
  it("runs extractFrames then askVideo, prints the answer to stdout", async () => {
    const deps = makeDeps();
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(okAnswer.kind === "ok" ? okAnswer.answer : "");
    expect(deps.extractFrames).toHaveBeenCalledTimes(1);
    expect(deps.askVideo).toHaveBeenCalledTimes(1);
  });

  it("passes the augmented transcript from extractFrames into askVideo", async () => {
    const deps = makeDeps();
    await runAsk(deps, baseUrl);
    const askArgs = vi.mocked(deps.askVideo).mock.calls[0][0];
    expect(askArgs.transcript).toBe(includedFrames.kind === "included" ? includedFrames.transcript : "");
    expect(askArgs.question).toBe("What's the logo?");
  });

  it("falls back to speech-only transcript when frames pipeline returns attempted-failed", async () => {
    const failed: FramesResult = {
      kind: "attempted-failed",
      reason: "download-failed",
      phase: "download",
      message: "Network down",
      metrics: sampleMetrics,
    };
    const deps = makeDeps({ extractFrames: vi.fn().mockResolvedValue(failed) });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/frames pipeline failed.*download-failed/);
    expect(deps.askVideo).toHaveBeenCalledTimes(1);
    const askArgs = vi.mocked(deps.askVideo).mock.calls[0][0];
    expect(askArgs.transcript).toContain("Hello world");
    expect(askArgs.transcript).not.toContain("[VISUAL]");
  });

  it("never calls extractFrames when transcript fetch fails (cost guard)", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue({
        kind: "unavailable",
        reason: "no-captions",
        message: "No captions",
      } satisfies TranscriptResult),
    });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(3);
    expect(deps.extractFrames).not.toHaveBeenCalled();
    expect(deps.askVideo).not.toHaveBeenCalled();
  });

  it("returns TRANSIENT when extractFrames itself throws (defense in depth)", async () => {
    const deps = makeDeps({
      extractFrames: vi.fn().mockRejectedValue(new Error("yt-dlp segfault")),
    });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/yt-dlp segfault/);
    expect(deps.askVideo).not.toHaveBeenCalled();
  });
});

describe("runAsk — stdin mode", () => {
  it("reads stdin as the transcript and skips extractFrames entirely", async () => {
    const piped = "[0:00] [VISUAL] piped transcript text\n";
    const deps = makeDeps({ readStdin: vi.fn().mockResolvedValue(piped) });
    const result = await runAsk(deps, {
      question: "what's piped?",
      openRouterKey: "sk-test",
    });
    expect(result.exitCode).toBe(0);
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
    expect(deps.extractFrames).not.toHaveBeenCalled();
    expect(deps.askVideo).toHaveBeenCalledTimes(1);
    const askArgs = vi.mocked(deps.askVideo).mock.calls[0][0];
    expect(askArgs.transcript).toBe(piped);
  });
});

describe("runAsk — askVideo failure modes", () => {
  it("maps reason=auth to ARG_ERROR (caller needs to fix their key)", async () => {
    const deps = makeDeps({
      askVideo: vi.fn().mockResolvedValue({
        kind: "failed",
        reason: "auth",
        message: "401 Invalid API key",
      } satisfies AskVideoResult),
    });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/auth/);
  });

  it("maps reason=rate-limited to TRANSIENT", async () => {
    const deps = makeDeps({
      askVideo: vi.fn().mockResolvedValue({
        kind: "failed",
        reason: "rate-limited",
        message: "429",
      } satisfies AskVideoResult),
    });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(4);
  });

  it("maps reason=transient to TRANSIENT", async () => {
    const deps = makeDeps({
      askVideo: vi.fn().mockResolvedValue({
        kind: "failed",
        reason: "transient",
        message: "network down",
      } satisfies AskVideoResult),
    });
    const result = await runAsk(deps, baseUrl);
    expect(result.exitCode).toBe(4);
  });
});
