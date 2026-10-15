// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollectionStagePoster } from "@/components/collections/collection-stage-poster";
import { buildSitting, type CollectionSitting, type SittingItem } from "@/lib/collection-entries";

const VERTICAL = 0.5625;

function sittingOf(
  items: { id: string; videoId: string; aspectRatio: number | null }[],
  durationSec: number | null = 90,
): CollectionSitting {
  const sittingItems: SittingItem[] = items.map((item) => ({
    ...item,
    startSec: null,
    endSec: null,
    videoTitle: null,
  }));
  const facts = Object.fromEntries(
    items.map((item) => [item.videoId, { title: null, channelName: null, durationSec }]),
  );
  return buildSitting(sittingItems, facts);
}

const twoShorts = sittingOf([
  { id: "a", videoId: "first", aspectRatio: VERTICAL },
  { id: "b", videoId: "second", aspectRatio: null },
]);

function renderPoster(
  sitting: CollectionSitting = twoShorts,
  entryIndex = 0,
  onPlay: () => void = () => {},
  canPlay = true,
) {
  return render(
    <CollectionStagePoster
      sitting={sitting}
      entry={sitting.entries[entryIndex] ?? null}
      canPlay={canPlay}
      onPlay={onPlay}
      className="stage-sizing"
    />,
  );
}

function poster(): HTMLImageElement | null {
  return document.querySelector("img");
}

function posterSrc(): string | null {
  return poster()?.getAttribute("src") ?? null;
}

function box(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[style*='--frame-aspect']");
  if (!element) throw new Error("The poster publishes no frame shape");
  return element;
}

/** Answers the current image's load the way YouTube answers a size it lacks. */
function loadAt(width: number): void {
  const image = poster();
  if (!image) throw new Error("The poster is showing no image to load");
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  fireEvent.load(image);
}

function fail(): void {
  const image = poster();
  if (!image) throw new Error("The poster is showing no image to fail");
  fireEvent.error(image);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CollectionStagePoster sources", () => {
  it("asks for the largest still of the cued entry first", () => {
    renderPoster();

    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/maxresdefault.jpg");
  });

  it("steps down a size each time one does not load", () => {
    renderPoster();

    fail();
    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/sddefault.jpg");
    fail();
    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/hqdefault.jpg");
  });

  it("steps down when YouTube answers with its 120 pixel placeholder", () => {
    renderPoster();

    loadAt(120);

    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/sddefault.jpg");
  });

  it("keeps a still that loaded at a real size", () => {
    renderPoster();

    loadAt(1280);

    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/maxresdefault.jpg");
  });

  it("steps past a placeholder that finished loading before the page came alive", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(120);

    renderPoster();

    expect(posterSrc()).toBe("https://i.ytimg.com/vi/first/sddefault.jpg");
  });

  it("leaves the dark field with Play still working when every size fails", () => {
    const onPlay = vi.fn();
    renderPoster(twoShorts, 0, onPlay);

    fail();
    fail();
    fail();
    fireEvent.click(screen.getByRole("button"));

    expect(poster()).toBeNull();
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("shows the next cued entry's still in the same box, failures and all", () => {
    const { rerender } = renderPoster();
    const firstBox = box();
    fail();

    rerender(
      <CollectionStagePoster
        sitting={twoShorts}
        entry={twoShorts.entries[1]}
        canPlay
        onPlay={() => {}}
        className="stage-sizing"
      />,
    );

    expect(box()).toBe(firstBox);
    expect(posterSrc()).toBe("https://i.ytimg.com/vi/second/maxresdefault.jpg");
  });

  it("is decorative, since the caption names the entry", () => {
    renderPoster();

    expect(poster()?.getAttribute("alt")).toBe("");
  });

  it("is fetched only where the stage is drawn, which a phone's is not", () => {
    renderPoster();

    expect(poster()?.getAttribute("loading")).toBe("lazy");
  });
});

describe("CollectionStagePoster box", () => {
  it("publishes the cued entry's shape for the stage to size from", () => {
    renderPoster();

    expect(box().style.getPropertyValue("--frame-aspect")).toBe(String(VERTICAL));
    expect(box().className).toContain("stage-sizing");
  });

  it("draws an entry of unknown shape at 16:9", () => {
    renderPoster(twoShorts, 1);

    expect(box().style.getPropertyValue("--frame-aspect")).toBe(String(16 / 9));
  });

  it("draws the dark field when there is no entry to show", () => {
    renderPoster(sittingOf([]), 0, () => {}, false);

    expect(poster()).toBeNull();
    expect(box().style.getPropertyValue("--frame-aspect")).toBe(String(16 / 9));
  });
});

describe("CollectionStagePoster Play", () => {
  it("is named like the header's Play and labelled with the count and runtime", () => {
    renderPoster();

    expect(
      screen.getByRole("button", { name: "Play the whole collection, 3 min" }),
    ).toBeTruthy();
    expect(screen.getByText("Play all 2 / 3 min")).toBeTruthy();
  });

  it("leaves the runtime out where a length is unknown", () => {
    renderPoster(
      sittingOf(
        [
          { id: "a", videoId: "first", aspectRatio: null },
          { id: "b", videoId: "second", aspectRatio: null },
        ],
        null,
      ),
    );

    expect(screen.getByRole("button", { name: "Play the whole collection" })).toBeTruthy();
    expect(screen.getByText("Play all 2")).toBeTruthy();
  });

  it("starts the run when pressed", () => {
    const onPlay = vi.fn();
    renderPoster(twoShorts, 0, onPlay);

    fireEvent.click(screen.getByRole("button"));

    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed when there is nothing to play", () => {
    const onPlay = vi.fn();
    renderPoster(sittingOf([]), 0, onPlay, false);

    fireEvent.click(screen.getByRole("button"));

    expect(onPlay).not.toHaveBeenCalled();
  });
});
