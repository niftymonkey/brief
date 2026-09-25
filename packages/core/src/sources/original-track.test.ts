import { describe, expect, it } from "vitest";
import { preferOriginalCaptionTrack } from "./original-track";

// Trimmed from the Innertube player response for KgKA0A3qlz0, an English video
// that YouTube auto-dubs. Track 0 is the Arabic dub's captions; every audio
// track names track 2, the English captions, as its default.
function dubbedPlayer() {
  return {
    playabilityStatus: { status: "OK" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: "ar", kind: "asr", baseUrl: "https://x/ar" },
          { languageCode: "bn", kind: "asr", baseUrl: "https://x/bn" },
          { languageCode: "en", kind: "asr", baseUrl: "https://x/en" },
        ],
        audioTracks: [
          { audioTrackId: "ar.10", defaultCaptionTrackIndex: 2 },
          { audioTrackId: "en-US.4", defaultCaptionTrackIndex: 2 },
        ],
        defaultAudioTrackIndex: 1,
      },
    },
  };
}

describe("preferOriginalCaptionTrack", () => {
  it("moves the default audio track's captions to the front", () => {
    const { player } = preferOriginalCaptionTrack(dubbedPlayer());
    expect(player).toMatchObject({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { languageCode: "en" },
            { languageCode: "ar" },
            { languageCode: "bn" },
          ],
        },
      },
    });
  });

  it("reports every caption language on offer", () => {
    expect(preferOriginalCaptionTrack(dubbedPlayer()).languages).toEqual([
      "ar",
      "bn",
      "en",
    ]);
  });

  it("keeps the rest of the player response intact", () => {
    const { player } = preferOriginalCaptionTrack(dubbedPlayer());
    expect(player).toMatchObject({
      playabilityStatus: { status: "OK" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: "https://x/en" }, {}, {}],
          defaultAudioTrackIndex: 1,
        },
      },
    });
  });

  it("falls back to the first audio track when no default is named", () => {
    const input = dubbedPlayer();
    const { defaultAudioTrackIndex: _, ...tracklist } =
      input.captions.playerCaptionsTracklistRenderer;
    const { player } = preferOriginalCaptionTrack({
      captions: { playerCaptionsTracklistRenderer: tracklist },
    });
    expect(player).toMatchObject({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: "en" }, {}, {}],
        },
      },
    });
  });

  it("leaves the order alone when there are no audio tracks", () => {
    const input = dubbedPlayer();
    const { audioTracks: _, ...tracklist } =
      input.captions.playerCaptionsTracklistRenderer;
    const original = { captions: { playerCaptionsTracklistRenderer: tracklist } };
    expect(preferOriginalCaptionTrack(original).player).toEqual(original);
  });

  it("leaves the order alone when the default index is out of range", () => {
    const input = dubbedPlayer();
    input.captions.playerCaptionsTracklistRenderer.audioTracks[1]!.defaultCaptionTrackIndex = 9;
    expect(preferOriginalCaptionTrack(input).player).toMatchObject({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: "ar" }, {}, {}],
        },
      },
    });
  });

  it("passes through a response that has no captions", () => {
    const input = { playabilityStatus: { status: "OK" } };
    expect(preferOriginalCaptionTrack(input)).toEqual({
      player: input,
      languages: [],
    });
  });
});
