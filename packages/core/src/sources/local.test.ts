import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalSource } from "./local";

const fetchTranscriptMock = vi.fn();

vi.mock("youtube-transcript-plus", () => {
  class YoutubeTranscriptDisabledError extends Error {}
  class YoutubeTranscriptNotAvailableError extends Error {}
  class YoutubeTranscriptNotAvailableLanguageError extends Error {}
  class YoutubeTranscriptVideoUnavailableError extends Error {}
  class YoutubeTranscriptInvalidVideoIdError extends Error {}
  class YoutubeTranscriptTooManyRequestError extends Error {}
  return {
    fetchTranscript: (...args: unknown[]) => fetchTranscriptMock(...args),
    YoutubeTranscriptDisabledError,
    YoutubeTranscriptNotAvailableError,
    YoutubeTranscriptNotAvailableLanguageError,
    YoutubeTranscriptVideoUnavailableError,
    YoutubeTranscriptInvalidVideoIdError,
    YoutubeTranscriptTooManyRequestError,
  };
});

import * as ytp from "youtube-transcript-plus";

const PLAYER_PARAMS = {
  url: "https://www.youtube.com/youtubei/v1/player?key=k",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
};

function dubbedPlayer() {
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: "ar", baseUrl: "https://x/ar" },
          { languageCode: "en", baseUrl: "https://x/en" },
        ],
        audioTracks: [{ defaultCaptionTrackIndex: 1 }],
        defaultAudioTrackIndex: 0,
      },
    },
  };
}

function stubPlayer(player: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(player), { status: 200 }))
  );
}

describe("LocalSource", () => {
  afterEach(() => {
    fetchTranscriptMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("identifies as youtube-transcript-plus", () => {
    expect(new LocalSource().name).toBe("youtube-transcript-plus");
  });

  it("returns ok with entries already in seconds", async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: "hello", offset: 0, duration: 2, lang: "en" },
      { text: "world", offset: 2, duration: 1.5, lang: "en" },
    ]);
    const result = await new LocalSource().fetch("vid");
    expect(result).toEqual({
      kind: "ok",
      lang: "en",
      entries: [
        { text: "hello", offsetSec: 0, durationSec: 2, lang: "en" },
        { text: "world", offsetSec: 2, durationSec: 1.5, lang: "en" },
      ],
    });
  });

  it("decodes HTML entities in entry text (including double-encoded)", async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: "we&amp;#39;re no strangers", offset: 0, duration: 2, lang: "en" },
      { text: "a &lt; b", offset: 2, duration: 1, lang: "en" },
    ]);
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.entries.map((e) => e.text)).toEqual([
        "we're no strangers",
        "a < b",
      ]);
    }
  });

  it("returns ok without lang when entries have no lang", async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: "hi", offset: 0, duration: 1 },
    ]);
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.lang).toBeUndefined();
    }
  });

  it("maps disabled error to unavailable: no-captions", async () => {
    fetchTranscriptMock.mockRejectedValue(
      new ytp.YoutubeTranscriptDisabledError("vid")
    );
    expect(await new LocalSource().fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "no-captions",
    });
  });

  it("maps not-available error to unavailable: no-captions", async () => {
    fetchTranscriptMock.mockRejectedValue(
      new ytp.YoutubeTranscriptNotAvailableError("vid")
    );
    expect(await new LocalSource().fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "no-captions",
    });
  });

  it("maps not-available-language to language-unavailable with the languages on offer", async () => {
    stubPlayer(dubbedPlayer());
    fetchTranscriptMock.mockImplementation(async (_id, config) => {
      await config.playerFetch(PLAYER_PARAMS);
      throw new ytp.YoutubeTranscriptNotAvailableLanguageError("xx", [], "vid");
    });
    expect(await new LocalSource({ lang: "xx" }).fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "language-unavailable",
      availableLangs: ["ar", "en"],
    });
  });

  it("fetches the original-language track of a dubbed video", async () => {
    stubPlayer(dubbedPlayer());
    fetchTranscriptMock.mockImplementation(async (_id, config) => {
      const res = await config.playerFetch(PLAYER_PARAMS);
      const player = await res.json();
      const first = player.captions.playerCaptionsTracklistRenderer.captionTracks[0];
      return [{ text: "hi", offset: 0, duration: 1, lang: first.languageCode }];
    });
    const result = await new LocalSource().fetch("vid");
    expect(result).toMatchObject({ kind: "ok", lang: "en" });
  });

  it("passes a requested language to the library", async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: "hola", offset: 0, duration: 1, lang: "es" },
    ]);
    await new LocalSource({ lang: "es" }).fetch("vid");
    expect(fetchTranscriptMock).toHaveBeenCalledWith(
      "vid",
      expect.objectContaining({ lang: "es" })
    );
  });

  it("returns a failed player response untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    fetchTranscriptMock.mockImplementation(async (_id, config) => {
      const res = await config.playerFetch(PLAYER_PARAMS);
      return [{ text: String(res.status), offset: 0, duration: 1 }];
    });
    const result = await new LocalSource().fetch("vid");
    expect(result).toMatchObject({ kind: "ok", entries: [{ text: "500" }] });
  });

  it("maps video-unavailable to unavailable: video-removed", async () => {
    fetchTranscriptMock.mockRejectedValue(
      new ytp.YoutubeTranscriptVideoUnavailableError("vid")
    );
    expect(await new LocalSource().fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "video-removed",
    });
  });

  it("maps invalid-video-id to unavailable: invalid-id", async () => {
    fetchTranscriptMock.mockRejectedValue(
      new ytp.YoutubeTranscriptInvalidVideoIdError()
    );
    expect(await new LocalSource().fetch("vid")).toEqual({
      kind: "unavailable",
      reason: "invalid-id",
    });
  });

  it("maps too-many-requests to transient", async () => {
    fetchTranscriptMock.mockRejectedValue(
      new ytp.YoutubeTranscriptTooManyRequestError()
    );
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") expect(result.cause).toBe("rate-limit");
  });

  it("maps unrecognized errors to transient with the error name as cause", async () => {
    fetchTranscriptMock.mockRejectedValue(new Error("ECONNRESET"));
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("transient");
  });

  it("maps malformed library response to transient: schema-mismatch", async () => {
    fetchTranscriptMock.mockResolvedValue([
      { text: "missing offset", duration: 1 },
    ]);
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("schema-mismatch");
    }
  });

  it("maps non-array library response to transient: schema-mismatch", async () => {
    fetchTranscriptMock.mockResolvedValue({ not: "an array" });
    const result = await new LocalSource().fetch("vid");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("schema-mismatch");
    }
  });
});
