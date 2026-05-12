import { describe, it, expect, vi } from "vitest";
import type { TranscriptResult } from "@brief/core";
import type { BriefResult, HostedClient } from "../hosted-client";
import { runGenerate, type RunGenerateDeps, type RunGenerateOptions } from "./run-generate";

// Shared base fixtures: tests spread these and override fields per case.

const okTranscript: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  entries: [
    { offsetSec: 0, durationSec: 2.5, text: "Hello world", lang: "en" },
  ],
};

const sampleMetadata = {
  videoId: "dQw4w9WgXcQ",
  title: "Test video",
  channelTitle: "Test channel",
  channelId: "UC_abc",
  duration: "PT1M",
  publishedAt: "2024-01-01T00:00:00Z",
  description: "Desc",
};

const briefOk: BriefResult = {
  kind: "ok",
  briefId: "brief_abc",
  briefUrl: "https://brief.test/brief/brief_abc",
  brief: {
    summary: "A summary",
    sections: [],
    relatedLinks: [],
    otherLinks: [],
  },
  metadata: sampleMetadata,
};

const baseOptions: RunGenerateOptions = {
  input: "dQw4w9WgXcQ",
  json: false,
  withFrames: false,
};

function stubHostedClient(result: BriefResult): HostedClient {
  return {
    submit: vi.fn().mockResolvedValue(result),
    whoami: vi.fn(),
    logout: vi.fn(),
  };
}

function makeDeps(overrides: Partial<RunGenerateDeps> = {}): RunGenerateDeps {
  return {
    fetchTranscript: vi.fn().mockResolvedValue(okTranscript),
    hostedClient: stubHostedClient(briefOk),
    progress: vi.fn(),
    ...overrides,
  };
}

describe("runGenerate", () => {
  it("prints the brief URL on stdout and exits 0 on success", async () => {
    const deps = makeDeps();
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("https://brief.test/brief/brief_abc");
  });

  it("emits the full BriefResult as JSON when json:true is set", async () => {
    const deps = makeDeps();
    const result = await runGenerate(deps, { ...baseOptions, json: true });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.briefId).toBe("brief_abc");
    expect(parsed.briefUrl).toBe("https://brief.test/brief/brief_abc");
    expect(parsed.brief.summary).toBe("A summary");
  });

  it("submits sum-type speech entries and frames.kind=not-requested by default", async () => {
    const deps = makeDeps();
    await runGenerate(deps, baseOptions);
    const [submission] = vi.mocked(deps.hostedClient.submit).mock.calls[0];
    expect(submission.transcript[0]).toEqual({
      kind: "speech",
      offsetSec: 0,
      durationSec: 2.5,
      text: "Hello world",
      lang: "en",
    });
    expect(submission.frames).toEqual({ kind: "not-requested" });
  });

  it("does not include metadata in the submission (server fetches it)", async () => {
    const deps = makeDeps();
    await runGenerate(deps, baseOptions);
    const [submission] = vi.mocked(deps.hostedClient.submit).mock.calls[0];
    expect(submission).not.toHaveProperty("metadata");
  });

  it("submits frames.kind=not-requested even when --with-frames is requested (no #87 yet)", async () => {
    const deps = makeDeps();
    await runGenerate(deps, { ...baseOptions, withFrames: true });
    const [submission] = vi.mocked(deps.hostedClient.submit).mock.calls[0];
    expect(submission.frames.kind).toBe("not-requested");
  });

  it("returns exit code 1 when input cannot be parsed as a YouTube video", async () => {
    const deps = makeDeps();
    const result = await runGenerate(deps, { ...baseOptions, input: "not a video" });
    expect(result.exitCode).toBe(1);
    expect(deps.fetchTranscript).not.toHaveBeenCalled();
  });

  it("returns exit code 5 when not signed in", async () => {
    const deps = makeDeps({
      hostedClient: stubHostedClient({ kind: "auth-required", reason: "missing" }),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toMatch(/sign in|brief login/i);
  });

  it("returns exit code 6 when server rejects the schema version", async () => {
    const deps = makeDeps({
      hostedClient: stubHostedClient({
        kind: "schema-mismatch",
        serverAccepts: ["3.0.0"],
        sent: "2.0.0",
      }),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(6);
    expect(result.stderr).toMatch(/upgrade/i);
  });

  it("returns exit code 4 with retry hint on rate-limited", async () => {
    const deps = makeDeps({
      hostedClient: stubHostedClient({ kind: "rate-limited", retryAfterSeconds: 120 }),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/120/);
  });

  it("returns exit code 4 on transient server errors", async () => {
    const deps = makeDeps({
      hostedClient: stubHostedClient({
        kind: "transient",
        cause: "http-503",
        message: "Server returned 503",
      }),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(4);
  });

  it("returns exit code 3 when transcript is unavailable (server never called)", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue({
        kind: "unavailable",
        reason: "no-captions",
        message: "No captions",
      } satisfies TranscriptResult),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(3);
    expect(deps.hostedClient.submit).not.toHaveBeenCalled();
  });

  it("emits progress lines for transcript-fetch and server-submit phases", async () => {
    const progress = vi.fn();
    const deps = makeDeps({ progress });
    await runGenerate(deps, baseOptions);
    const calls = progress.mock.calls.map(([line]) => line as string);
    expect(calls).toEqual([
      expect.stringMatching(/fetch.*transcript/i),
      expect.stringMatching(/generat.*brief/i),
    ]);
  });

  it("returns exit code 4 when transcript fetch is transient (server never called)", async () => {
    const deps = makeDeps({
      fetchTranscript: vi.fn().mockResolvedValue({
        kind: "transient",
        cause: "timeout",
        message: "Upstream timed out",
      } satisfies TranscriptResult),
    });
    const result = await runGenerate(deps, baseOptions);
    expect(result.exitCode).toBe(4);
    expect(deps.hostedClient.submit).not.toHaveBeenCalled();
  });
});
