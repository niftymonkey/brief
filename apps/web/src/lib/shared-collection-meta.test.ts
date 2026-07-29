import { describe, expect, it } from "vitest";
import type { CollectionSitting } from "./collection-entries";
import { sharedCollectionDescription, unfurlThumbnailUrl } from "./shared-collection-meta";

function sitting(entryCount: number, totalRuntimeSec: number | null): CollectionSitting {
  return {
    entries: Array.from({ length: entryCount }, (_, index) => ({
      id: `item-${index}`,
      ordinal: index + 1,
      anchorId: `entry-${index + 1}`,
      videoId: `vid${index}`,
      title: `Entry ${index + 1}`,
      channelName: null,
      startSec: null,
      endSec: null,
      durationSec: null,
      offsetSec: null,
      rangeLabel: "full clip",
      kindLabel: "Full video",
      aspectRatio: null,
      watchUrl: `https://youtube.com/watch?v=vid${index}`,
      thumbnailUrl: `https://img.youtube.com/vi/vid${index}/mqdefault.jpg`,
      thumbnailFallbackUrl: null,
    })),
    totalRuntimeSec,
    runtimeComplete: totalRuntimeSec !== null,
  };
}

describe("sharedCollectionDescription", () => {
  it("prefers the curator's own framing", () => {
    expect(sharedCollectionDescription("Everything Pocock said about AI.", sitting(3, 1976))).toBe(
      "Everything Pocock said about AI.",
    );
  });

  it("collapses newlines and runs of whitespace in the curator's framing", () => {
    expect(sharedCollectionDescription("Two\n\nparagraphs   here.", sitting(1, 60))).toBe(
      "Two paragraphs here.",
    );
  });

  it("truncates an over-long framing to 160 characters including the ellipsis", () => {
    const description = sharedCollectionDescription("a".repeat(400), sitting(1, 60));
    expect(description).toHaveLength(160);
    expect(description.endsWith("...")).toBe(true);
  });

  it("keeps a framing that lands exactly on the limit intact", () => {
    const exact = "b".repeat(160);
    expect(sharedCollectionDescription(exact, sitting(1, 60))).toBe(exact);
  });

  it("cuts on a whole character so an emoji straddling the limit survives", () => {
    const framing = `${"a".repeat(156)}\u{1F600}${"b".repeat(60)}`;
    const description = sharedCollectionDescription(framing, sitting(1, 60));

    expect(description.endsWith("\u{1F600}...")).toBe(true);
    expect(Array.from(description)).toHaveLength(160);
  });

  it("measures the limit in characters, so 160 emoji are already short enough", () => {
    const exact = "\u{1F600}".repeat(160);
    expect(sharedCollectionDescription(exact, sitting(1, 60))).toBe(exact);
  });

  it("falls back to the sitting when there is no framing", () => {
    expect(sharedCollectionDescription(null, sitting(3, 1976))).toBe(
      "3 entries, 32 min 56 sec, curated to play through in order.",
    );
  });

  it("treats a whitespace-only framing as no framing", () => {
    expect(sharedCollectionDescription("   \n  ", sitting(3, 1976))).toBe(
      "3 entries, 32 min 56 sec, curated to play through in order.",
    );
  });

  it("says nothing about runtime when a length is unknown", () => {
    expect(sharedCollectionDescription(null, sitting(3, null))).toBe(
      "3 entries curated to play through in order.",
    );
  });

  it("uses the singular for a one-entry collection", () => {
    expect(sharedCollectionDescription(null, sitting(1, 90))).toBe(
      "1 entry, 1 min 30 sec, curated to play through in order.",
    );
  });

  it("describes an empty collection without claiming entries", () => {
    expect(sharedCollectionDescription(null, sitting(0, null))).toBe(
      "A collection on Brief.",
    );
  });
});

describe("unfurlThumbnailUrl", () => {
  it("builds the same high-quality still a shared brief unfurls with", () => {
    expect(unfurlThumbnailUrl("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("has nothing to show when there is no first entry", () => {
    expect(unfurlThumbnailUrl(undefined)).toBeNull();
  });
});
