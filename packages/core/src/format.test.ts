import { describe, expect, it } from "vitest";
import { formatTranscript, SCHEMA_VERSION } from "./format";
import type { TranscriptResult } from "./types";

const okResult: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  lang: "en",
  entries: [
    { offsetSec: 0, durationSec: 2, text: "hello" },
    { offsetSec: 65, durationSec: 3, text: "world" },
    { offsetSec: 3725, durationSec: 4, text: "later" },
  ],
};

const pendingResult: TranscriptResult = {
  kind: "pending",
  source: "supadata",
  jobId: "job-123",
  retryAfterSeconds: 90,
  message: "Transcript generation queued",
};

const unavailableResult: TranscriptResult = {
  kind: "unavailable",
  reason: "no-captions",
  message: "No captions available",
};

const transientResult: TranscriptResult = {
  kind: "transient",
  cause: "ECONNRESET",
  message: "Network error talking to upstream",
};

describe("formatTranscript text format", () => {
  it("renders ok entries as [MM:SS] lines", () => {
    expect(formatTranscript(okResult, "text")).toBe(
      "[00:00] hello\n[01:05] world\n[1:02:05] later"
    );
  });

  it("renders pending as a single informative line", () => {
    expect(formatTranscript(pendingResult, "text")).toBe(
      "Transcript generation queued (jobId: job-123, retryAfter: 90s)"
    );
  });

  it("renders unavailable as a single line with the reason", () => {
    expect(formatTranscript(unavailableResult, "text")).toBe(
      "Unavailable (no-captions): No captions available"
    );
  });

  it("renders transient as a single line with the cause", () => {
    expect(formatTranscript(transientResult, "text")).toBe(
      "Transient failure (ECONNRESET): Network error talking to upstream"
    );
  });
});

describe("formatTranscript json format", () => {
  it("uses schemaVersion 1.0.0", () => {
    const out = JSON.parse(formatTranscript(okResult, "json"));
    expect(out.schemaVersion).toBe("1.0.0");
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });

  it("renders ok with status, source, transcript entries", () => {
    const out = JSON.parse(formatTranscript(okResult, "json"));
    expect(out.status).toBe("ok");
    expect(out.source).toBe("youtube-transcript-plus");
    expect(out.transcript).toEqual({
      language: "en",
      entries: [
        { offsetSec: 0, durationSec: 2, text: "hello" },
        { offsetSec: 65, durationSec: 3, text: "world" },
        { offsetSec: 3725, durationSec: 4, text: "later" },
      ],
    });
    expect(out.job).toBeNull();
    expect(out.reason).toBeUndefined();
    expect(out.message).toEqual(expect.any(String));
  });

  it("renders pending with job and source, transcript null", () => {
    const out = JSON.parse(formatTranscript(pendingResult, "json"));
    expect(out.status).toBe("pending");
    expect(out.source).toBe("supadata");
    expect(out.transcript).toBeNull();
    expect(out.job).toEqual({ id: "job-123", retryAfterSeconds: 90 });
    expect(out.message).toBe("Transcript generation queued");
  });

  it("renders unavailable with reason, source null, transcript null", () => {
    const out = JSON.parse(formatTranscript(unavailableResult, "json"));
    expect(out.status).toBe("unavailable");
    expect(out.source).toBeNull();
    expect(out.reason).toBe("no-captions");
    expect(out.transcript).toBeNull();
    expect(out.job).toBeNull();
    expect(out.message).toBe("No captions available");
  });

  it("renders transient with source null and no reason", () => {
    const out = JSON.parse(formatTranscript(transientResult, "json"));
    expect(out.status).toBe("transient");
    expect(out.source).toBeNull();
    expect(out.transcript).toBeNull();
    expect(out.job).toBeNull();
    expect(out.reason).toBeUndefined();
    expect(out.message).toBe("Network error talking to upstream");
  });

  it("includes a `video` object placeholder (id/url empty since serializer has no metadata)", () => {
    const out = JSON.parse(formatTranscript(okResult, "json"));
    expect(out.video).toBeDefined();
    expect(out.video).toEqual({});
  });
});
