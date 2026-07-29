// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import { buildSitting } from "@/lib/collection-entries";
import type { CollectionItem } from "@/lib/collections";

const VERTICAL = 0.5625;

function renderRow(aspectRatio: number | null): void {
  const item: CollectionItem = {
    id: "item-a",
    videoId: "vid",
    startSec: null,
    endSec: null,
    videoTitle: "An entry",
    durationSec: 90,
    aspectRatio,
    summary: "A note.",
    summaryStatus: "ready",
    position: 0,
  };
  const [entry] = buildSitting([item], {}).entries;

  render(<CollectionItemRow item={item} entry={entry} isFirst isLast isActive={false} />);
}

function thumbnailSrc(): string | null {
  return document.querySelector("img")?.getAttribute("src") ?? null;
}

function failThumbnail(): void {
  const image = document.querySelector("img");
  if (!image) throw new Error("The row is showing no thumbnail to fail");
  fireEvent.error(image);
}

describe("CollectionItemRow thumbnail", () => {
  afterEach(cleanup);

  it("shows the native frame of a vertical entry", () => {
    renderRow(VERTICAL);

    expect(thumbnailSrc()).toBe("https://i.ytimg.com/vi/vid/frame0.jpg");
  });

  it("shows mqdefault for an entry whose shape was never resolved", () => {
    renderRow(null);

    expect(thumbnailSrc()).toBe("https://img.youtube.com/vi/vid/mqdefault.jpg");
  });

  it("steps a vertical entry down to mqdefault, then to the placeholder", () => {
    renderRow(VERTICAL);

    failThumbnail();
    expect(thumbnailSrc()).toBe("https://img.youtube.com/vi/vid/mqdefault.jpg");

    failThumbnail();
    expect(document.querySelector("img")).toBeNull();
    // The placeholder underneath the still names the video the row points at.
    expect(document.body.textContent).toContain("vid");
  });

  it("drops straight to the placeholder when the only still fails", () => {
    renderRow(null);

    failThumbnail();
    expect(document.querySelector("img")).toBeNull();
  });
});
