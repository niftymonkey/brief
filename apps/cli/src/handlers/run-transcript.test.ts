import { describe, it, expect, vi } from "vitest";
import type { MetadataResult, TranscriptResult } from "@brief/core";
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
