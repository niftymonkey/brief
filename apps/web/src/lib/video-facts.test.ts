import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetadata } from "@brief/core";
import type { MetadataResult, VideoMetadata } from "@brief/core";
import { METADATA_TIMEOUT_MS, fetchYouTubeVideoFacts } from "./video-facts";

vi.mock("@brief/core", () => ({ fetchMetadata: vi.fn() }));

const mockedFetchMetadata = vi.mocked(fetchMetadata);

const sampleMetadata: VideoMetadata = {
  videoId: "dQw4w9WgXcQ",
  title: "The Real YouTube Title",
  channelTitle: "Some Channel",
  channelId: "UC123",
  duration: "PT5M30S",
  publishedAt: "2024-01-01T00:00:00Z",
  description: "",
};

/**
 * Builds an `ok` metadata result whose fields may fall outside the types
 * `VideoMetadata` declares. The declared types describe what the YouTube client
 * is supposed to hand back, not what the runtime can actually produce, and the
 * point of these cases is what happens when the two disagree. The cast is the
 * seam where that deliberate disagreement is expressed.
 */
function okWithFields(fields: Record<string, unknown>): MetadataResult {
  return { kind: "ok", metadata: { ...sampleMetadata, ...fields } as VideoMetadata };
}

describe("fetchYouTubeVideoFacts", () => {
  const originalKey = process.env.YOUTUBE_API_KEY;

  beforeEach(() => {
    mockedFetchMetadata.mockReset();
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = originalKey;
    }
  });

  it("returns the live title and runtime from a single YouTube lookup", async () => {
    mockedFetchMetadata.mockResolvedValue({ kind: "ok", metadata: sampleMetadata });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: "The Real YouTube Title",
      durationSec: 330,
      aspectRatio: null,
    });
    expect(mockedFetchMetadata).toHaveBeenCalledTimes(1);
    expect(mockedFetchMetadata).toHaveBeenCalledWith("dQw4w9WgXcQ", {
      youtubeApiKey: "test-youtube-key",
    });
  });

  it("converts an hours-long ISO runtime to seconds", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "ok",
      metadata: { ...sampleMetadata, duration: "PT1H2M30S" },
    });

    expect((await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).durationSec).toBe(3750);
  });

  it("treats a zero-length runtime as unknown", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "ok",
      metadata: { ...sampleMetadata, duration: "PT0S" },
    });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: "The Real YouTube Title",
      durationSec: null,
      aspectRatio: null,
    });
  });

  it("returns empty facts without calling YouTube when no API key is configured", async () => {
    delete process.env.YOUTUBE_API_KEY;

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
    expect(mockedFetchMetadata).not.toHaveBeenCalled();
  });

  it("returns empty facts without calling YouTube when the API key is blank", async () => {
    process.env.YOUTUBE_API_KEY = "   ";

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
    expect(mockedFetchMetadata).not.toHaveBeenCalled();
  });

  it("returns empty facts when the video is unavailable", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "unavailable",
      reason: "video-not-found",
      message: "Video not found or unavailable",
    });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
  });

  it("returns empty facts when the API key is rejected", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "unavailable",
      reason: "api-key-invalid",
      message: "bad key",
    });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
  });

  it("returns empty facts on a transient metadata failure", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "transient",
      cause: "ECONNRESET",
      message: "Transient failure fetching metadata: ECONNRESET",
    });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
  });

  it("returns empty facts instead of propagating a thrown metadata error", async () => {
    mockedFetchMetadata.mockRejectedValue(new Error("network exploded"));

    await expect(fetchYouTubeVideoFacts("dQw4w9WgXcQ")).resolves.toEqual({
      title: null,
      durationSec: null,
      aspectRatio: null,
    });
  });

  it("returns a null title but keeps the runtime when YouTube reports a blank title", async () => {
    mockedFetchMetadata.mockResolvedValue({
      kind: "ok",
      metadata: { ...sampleMetadata, title: "  " },
    });

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: 330,
      aspectRatio: null,
    });
  });

  it("gives up on a stalled lookup and returns empty facts instead of hanging", async () => {
    mockedFetchMetadata.mockReturnValue(new Promise<MetadataResult>(() => {}));

    vi.useFakeTimers();
    try {
      const pending = fetchYouTubeVideoFacts("dQw4w9WgXcQ");
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ title: null, durationSec: null, aspectRatio: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a lookup that answers inside the timeout", async () => {
    mockedFetchMetadata.mockResolvedValue({ kind: "ok", metadata: sampleMetadata });

    vi.useFakeTimers();
    try {
      const pending = fetchYouTubeVideoFacts("dQw4w9WgXcQ");
      await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS * 2);
      await expect(pending).resolves.toEqual({
        title: "The Real YouTube Title",
        durationSec: 330,
        aspectRatio: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats the 'Untitled' placeholder as no title at all", async () => {
    mockedFetchMetadata.mockResolvedValue(okWithFields({ title: "Untitled" }));

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: null,
      durationSec: 330,
      aspectRatio: null,
    });
  });

  it("keeps the title when a non-string runtime arrives", async () => {
    for (const duration of [null, undefined, 42]) {
      mockedFetchMetadata.mockResolvedValue(okWithFields({ duration }));

      expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
        title: "The Real YouTube Title",
        durationSec: null,
        aspectRatio: null,
      });
    }
  });

  it("keeps the runtime when a non-string title arrives", async () => {
    for (const title of [null, undefined, 42]) {
      mockedFetchMetadata.mockResolvedValue(okWithFields({ title }));

      expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
        title: null,
        durationSec: 330,
        aspectRatio: null,
      });
    }
  });

  it("keeps the aspect ratio the lookup reported", async () => {
    mockedFetchMetadata.mockResolvedValue(okWithFields({ aspectRatio: 0.5625 }));

    expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
      title: "The Real YouTube Title",
      durationSec: 330,
      aspectRatio: 0.5625,
    });
  });

  it("keeps a 4:3 ratio as itself rather than rounding it towards 16:9", async () => {
    mockedFetchMetadata.mockResolvedValue(okWithFields({ aspectRatio: 1.3333 }));

    expect((await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).aspectRatio).toBeCloseTo(1.3333, 4);
  });

  it("treats an absent aspect ratio as unknown", async () => {
    mockedFetchMetadata.mockResolvedValue({ kind: "ok", metadata: sampleMetadata });

    expect((await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).aspectRatio).toBeNull();
  });

  it("keeps the other facts when an unusable aspect ratio arrives", async () => {
    const unusable = [0, -1.7778, Number.NaN, Number.POSITIVE_INFINITY, "1.7778", null];
    for (const aspectRatio of unusable) {
      mockedFetchMetadata.mockResolvedValue(okWithFields({ aspectRatio }));

      expect(await fetchYouTubeVideoFacts("dQw4w9WgXcQ")).toEqual({
        title: "The Real YouTube Title",
        durationSec: 330,
        aspectRatio: null,
      });
    }
  });
});
