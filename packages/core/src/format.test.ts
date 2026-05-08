import { describe, expect, it } from "vitest";
import { formatTranscript, SCHEMA_VERSION } from "./format";
import type { TranscriptResult } from "./types";

const okResult: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  lang: "en",
  entries: [
    { offsetSec: 0, durationSec: 2, text: "hello" },
    { offsetSec: 2, durationSec: 2, text: "world" },
    { offsetSec: 4, durationSec: 2, text: "later" },
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
  it("renders ok as a single space-separated blob of text", () => {
    expect(formatTranscript(okResult, "text")).toBe("hello world later");
  });

  it("normalizes internal soft-wrap newlines within entry text to spaces", () => {
    const result: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      entries: [
        {
          offsetSec: 0,
          durationSec: 2,
          text: "you know the rules\nand so do I",
        },
        { offsetSec: 2, durationSec: 1, text: "single line" },
      ],
    };
    expect(formatTranscript(result, "text")).toBe(
      "you know the rules and so do I single line"
    );
  });

  it("preserves entry text containing punctuation without inserting breaks", () => {
    const result: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      entries: [
        { offsetSec: 0, durationSec: 2, text: "first thought." },
        { offsetSec: 2, durationSec: 2, text: "second thought" },
      ],
    };
    expect(formatTranscript(result, "text")).toBe(
      "first thought. second thought"
    );
  });

  it("ignores wide timestamp gaps (no paragraph break)", () => {
    const result: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      entries: [
        { offsetSec: 0, durationSec: 2, text: "topic A wraps up" },
        { offsetSec: 30, durationSec: 2, text: "new topic begins" },
      ],
    };
    expect(formatTranscript(result, "text")).toBe(
      "topic A wraps up new topic begins"
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
    expect(out.transcript.language).toBe("en");
    expect(out.transcript.entries).toEqual([
      { offsetSec: 0, durationSec: 2, text: "hello" },
      { offsetSec: 2, durationSec: 2, text: "world" },
      { offsetSec: 4, durationSec: 2, text: "later" },
    ]);
    expect(out.job).toBeNull();
    expect(out.reason).toBeUndefined();
    expect(out.message).toEqual(expect.any(String));
  });

  it("includes a joined `text` field on ok results (single blob, soft-wraps normalized)", () => {
    const out = JSON.parse(formatTranscript(okResult, "json"));
    expect(out.transcript.text).toBe("hello world later");
  });

  it("preserves per-entry `text` verbatim while joined `text` normalizes soft-wraps", () => {
    const result: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      lang: "en",
      entries: [
        { offsetSec: 0, durationSec: 2, text: "you know the rules\nand so do I" },
        { offsetSec: 2, durationSec: 2, text: "a full commitment's\nwhat I'm thinking of" },
      ],
    };
    const out = JSON.parse(formatTranscript(result, "json"));
    expect(out.transcript.text).toBe(
      "you know the rules and so do I a full commitment's what I'm thinking of"
    );
    expect(out.transcript.entries[0].text).toBe(
      "you know the rules\nand so do I"
    );
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
