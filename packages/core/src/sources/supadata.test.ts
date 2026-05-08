import { afterEach, describe, expect, it, vi } from "vitest";
import { SupadataSource } from "./supadata";

const transcriptMock = vi.fn();

vi.mock("@supadata/js", () => {
  class SupadataError extends Error {
    error: string;
    details: string;
    constructor({
      error,
      message,
      details,
    }: {
      error: string;
      message?: string;
      details?: string;
    }) {
      super(message ?? error);
      this.error = error;
      this.details = details ?? "";
    }
  }
  return {
    Supadata: class {
      constructor(_config: unknown) {
        void _config;
      }
      transcript = transcriptMock;
    },
    SupadataError,
  };
});

import { SupadataError } from "@supadata/js";

describe("SupadataSource", () => {
  afterEach(() => {
    transcriptMock.mockReset();
  });

  it("identifies as supadata", () => {
    expect(new SupadataSource("key").name).toBe("supadata");
  });

  it("converts ms to seconds in inline content", async () => {
    transcriptMock.mockResolvedValue({
      content: [
        { text: "hello", offset: 0, duration: 2000, lang: "en" },
        { text: "world", offset: 2000, duration: 1500, lang: "en" },
      ],
      lang: "en",
      availableLangs: ["en"],
    });
    const result = await new SupadataSource("key").fetch("vid");
    expect(result).toEqual({
      kind: "ok",
      lang: "en",
      entries: [
        { text: "hello", offsetSec: 0, durationSec: 2, lang: "en" },
        { text: "world", offsetSec: 2, durationSec: 1.5, lang: "en" },
      ],
    });
  });

  it("returns pending with default retryAfter when response has only jobId", async () => {
    transcriptMock.mockResolvedValue({ jobId: "abc-123" });
    const result = await new SupadataSource("key").fetch("vid");
    expect(result).toEqual({
      kind: "pending",
      jobId: "abc-123",
      retryAfterSeconds: 90,
    });
  });

  it("maps SupadataError 'transcript-unavailable' to unavailable: no-captions", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({
        error: "transcript-unavailable",
        message: "No captions",
      })
    );
    expect(await new SupadataSource("key").fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "no-captions",
    });
  });

  it("maps SupadataError 'not-found' to unavailable: video-removed", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "not-found", message: "Video not found" })
    );
    expect(await new SupadataSource("key").fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "video-removed",
    });
  });

  it("maps SupadataError 'invalid-request' to unavailable: invalid-id", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "invalid-request", message: "Bad URL" })
    );
    expect(await new SupadataSource("key").fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "invalid-id",
    });
  });

  it("maps SupadataError 'limit-exceeded' to transient with cause limit-exceeded", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "limit-exceeded", message: "Quota exhausted" })
    );
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("limit-exceeded");
    }
  });

  it("maps SupadataError 'upgrade-required' to transient", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "upgrade-required", message: "" })
    );
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
  });

  it("maps SupadataError 'unauthorized' to transient with cause unauthorized", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "unauthorized", message: "Bad key" })
    );
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("unauthorized");
    }
  });

  it("maps SupadataError 'internal-error' to transient", async () => {
    transcriptMock.mockRejectedValue(
      new SupadataError({ error: "internal-error", message: "" })
    );
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
  });

  it("maps generic thrown error to transient", async () => {
    transcriptMock.mockRejectedValue(new Error("ECONNRESET"));
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
  });

  it("maps malformed response (missing lang on success) to transient: schema-mismatch", async () => {
    transcriptMock.mockResolvedValue({
      content: [{ text: "x", offset: 0, duration: 1000, lang: "en" }],
    });
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("schema-mismatch");
    }
  });

  it("maps string content (no timestamps) to transient: schema-mismatch", async () => {
    transcriptMock.mockResolvedValue({
      content: "raw string transcript",
      lang: "en",
      availableLangs: ["en"],
    });
    const result = await new SupadataSource("key").fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("schema-mismatch");
    }
  });

  it("passes the videoId as a youtube URL to the SDK with mode auto", async () => {
    transcriptMock.mockResolvedValue({ jobId: "x" });
    await new SupadataSource("key").fetch("dQw4w9WgXcQ");
    expect(transcriptMock).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      mode: "auto",
    });
  });
});
