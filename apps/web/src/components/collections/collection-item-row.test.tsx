// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import { buildSitting } from "@/lib/collection-entries";
import type { CollectionItem } from "@/lib/collections";

const VERTICAL = 0.5625;

function renderRow(aspectRatio: number | null, isActive = false, isLast = true): void {
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
  const [entry] = buildSitting([item], {
    vid: { title: null, channelName: null, durationSec: 90 },
  }).entries;

  render(
    <CollectionItemRow item={item} entry={entry} isLast={isLast} isActive={isActive} />,
  );
}

function marker(): Element | undefined {
  return [...document.querySelectorAll("span")].find(
    (node) => node.textContent === "01" && node.className.includes("rounded-full"),
  );
}

function rail(): Element | undefined {
  return [...document.querySelectorAll("span")].find(
    (node) => node.className.includes("w-px") && node.className.includes("absolute"),
  );
}

function thumbnailSrc(): string | null {
  return document.querySelector("img")?.getAttribute("src") ?? null;
}

/** The fixed-width slot the still is centred in, whatever shape the still is. */
function thumbnailSlot(): HTMLElement {
  const slot = document.querySelector<HTMLElement>("[style*='--thumb-aspect']");
  if (!slot) throw new Error("The row is showing no thumbnail slot");
  return slot;
}

function thumbnailLink(): HTMLElement {
  const link = thumbnailSlot().querySelector<HTMLElement>("a");
  if (!link) throw new Error("The slot is holding no thumbnail");
  return link;
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

// Media queries do not resolve in jsdom, so the phone and desktop sizes are asserted
// as the classes that carry them.
describe("CollectionItemRow thumbnail slot", () => {
  afterEach(cleanup);

  it("gives both shapes the same slot, so the note wraps at the same x", () => {
    renderRow(VERTICAL);
    const verticalSlot = thumbnailSlot().className;
    const verticalStill = thumbnailLink().className;
    cleanup();

    renderRow(null);
    const landscapeSlot = thumbnailSlot().className;

    expect(verticalSlot).toBe(landscapeSlot);
    expect(verticalSlot).toContain("w-19");
    expect(verticalSlot).toContain("sm:w-26");
    // Only the still inside the slot changes shape, and it is centred in it.
    expect(verticalStill).toContain("mx-auto");
    expect(verticalStill).toContain("w-[calc(3.5rem*var(--thumb-aspect))]");
    expect(verticalStill).toContain("sm:w-[calc(4.75rem*var(--thumb-aspect))]");
    expect(thumbnailLink().className).toContain("w-full");
  });
});

describe("CollectionItemRow active entry", () => {
  afterEach(cleanup);

  it("says which entry is playing, and hides the words where they would crush the title", () => {
    renderRow(null, true);

    const marker = [...document.querySelectorAll("span")].find(
      (node) => node.textContent === "now playing",
    );
    expect(marker).toBeTruthy();
    expect(marker?.className).toContain("hidden");
    expect(marker?.className).toContain("sm:inline");
    expect(document.querySelector('[aria-current="true"]')).toBeTruthy();
  });

  it("shows the entry's runtime where an inactive row has nothing to announce", () => {
    renderRow(null);

    expect(document.body.textContent).toContain("1:30");
    expect(document.body.textContent).not.toContain("now playing");
  });

  it("fills the ordinal marker and lights its rail while the sitting is here", () => {
    renderRow(null, true, false);

    expect(marker()?.className).toContain("bg-[var(--color-playing)]");
    expect(marker()?.className).toContain("rounded-full");
    expect(rail()?.className).toContain("bg-[var(--color-playing)]");
  });

  it("leaves the marker and rail unlit on a row the sitting is not on", () => {
    renderRow(null, false, false);

    expect(marker()?.className).toContain("bg-[var(--color-bg-secondary)]");
    expect(rail()?.className).toContain("bg-[var(--color-border)]");
  });

  it("hangs the rail below its own marker, so the next one is never lit by it", () => {
    renderRow(null, true, false);

    // Starts at the marker's lower edge and ends where the next marker begins.
    expect(rail()?.className).toContain("top-8");
    expect(rail()?.className).toContain("-bottom-11");
  });

  it("gives the last row no rail, which is what ends the line", () => {
    renderRow(null, true, true);

    expect(marker()?.className).toContain("bg-[var(--color-playing)]");
    expect(rail()).toBeUndefined();
  });
});
