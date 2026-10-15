// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import { buildSitting } from "@/lib/collection-entries";
import type { CollectionItem } from "@/lib/collections";

const VERTICAL = 0.5625;

interface RowOptions {
  isCued?: boolean;
  onJump?: () => void;
}

function renderRow(
  aspectRatio: number | null,
  isActive = false,
  isLast = true,
  { isCued = false, onJump }: RowOptions = {},
): void {
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
    <CollectionItemRow
      item={item}
      entry={entry}
      isLast={isLast}
      isActive={isActive}
      isCued={isCued}
      onJump={onJump}
    />,
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

describe("CollectionItemRow drag grip", () => {
  afterEach(cleanup);

  it("names the entry it reorders", () => {
    const item: CollectionItem = {
      id: "item-a",
      videoId: "vid",
      startSec: null,
      endSec: null,
      videoTitle: "An entry",
      durationSec: 90,
      aspectRatio: null,
      summary: "A note.",
      summaryStatus: "ready",
      position: 0,
    };
    const [entry] = buildSitting([item], {
      vid: { title: null, channelName: null, durationSec: 90 },
    }).entries;
    const settled = async () => {};

    render(
      <CollectionItemRow
        item={item}
        entry={entry}
        isLast
        isActive={false}
        controls={{
          onRemove: settled,
          onSummarySave: settled,
          onRetrySummary: settled,
          onSwap: settled,
        }}
        drag={{
          setNodeRef: () => {},
          setGripRef: () => {},
          style: {},
          gripProps: { role: "button", tabIndex: 0, "aria-roledescription": "sortable" },
          isDragging: false,
        }}
      />,
    );

    const grip = screen.getByRole("button", { name: "Reorder An entry" });
    expect(grip.getAttribute("aria-roledescription")).toBe("sortable");
    expect(grip.getAttribute("title")).toBe(
      "Drag to reorder, or press space and use the arrow keys",
    );
  });
});

// The jump is a wide-screen control: below lg the marker stays a plain span, which
// is the one the tests above read.
describe("CollectionItemRow jump", () => {
  afterEach(cleanup);

  function jumpButton(): HTMLElement {
    return screen.getByRole("button", { name: "Go to An entry" });
  }

  it("jumps to the entry from its marker", () => {
    const onJump = vi.fn();
    renderRow(null, false, true, { onJump });

    fireEvent.click(jumpButton());

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(jumpButton().textContent).toBe("01");
  });

  it("offers no jump where the page has nowhere to jump to", () => {
    renderRow(null);

    expect(screen.queryByRole("button", { name: /^Go to/ })).toBeNull();
  });

  it("rings the cued entry's marker in a neutral tone, never gold", () => {
    renderRow(null, false, true, { isCued: true, onJump: () => {} });

    expect(jumpButton().className).toContain("border-[var(--color-text-secondary)]");
    expect(jumpButton().className).toContain("text-[var(--color-text-primary)]");
    expect(jumpButton().className).not.toContain("--color-playing");
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it("lights the marker gold, not the cue ring, on the entry playing", () => {
    renderRow(null, true, true, { isCued: true, onJump: () => {} });

    expect(jumpButton().className).toContain("bg-[var(--color-playing)]");
    expect(jumpButton().className).not.toContain("border-[var(--color-text-secondary)]");
  });

  it("says the channel and runtime under the title, and now playing in their place", () => {
    renderRow(null, false, true, { onJump: () => {} });
    expect(document.body.textContent).toContain("1:30");
    cleanup();

    renderRow(null, true, true, { onJump: () => {} });
    const lines = [...document.querySelectorAll("p")].filter(
      (node) => node.textContent === "now playing",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.className).toContain("text-[var(--color-playing)]");
  });
});
