// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CollectionPlayer,
  type CollectionPlayerItem,
} from "@/components/collections/collection-player";
import {
  FakeYouTubePlayer,
  VIDEO_A,
  VIDEO_B,
  installFakeYouTubePlayer,
  livePlayer,
  playFor,
  settle,
  uninstallFakeYouTubePlayer,
} from "@/test/collection-playback-harness";

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

const LANDSCAPE = 1.7778;
const VERTICAL = 0.5625;

function playerItem(
  id: string,
  videoId: string,
  aspectRatio: number | null,
): CollectionPlayerItem {
  return {
    id,
    videoId,
    videoTitle: `Title ${id}`,
    summary: null,
    startSec: 0,
    endSec: 10,
    aspectRatio,
  };
}

function renderPlayer(items: CollectionPlayerItem[]) {
  return render(<CollectionPlayer items={items} />);
}

/** The one element the iframe lives inside, whatever shape it is drawn at. */
function frame(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-frame-shape]");
  if (!element) throw new Error("No frame was rendered");
  return element;
}

/** The shape the frame holding the iframe is currently drawn at. */
function frameShape(): string | null {
  return frame().getAttribute("data-frame-shape");
}

async function startSitting(): Promise<void> {
  await settle();
  await settle();
}

describe("CollectionPlayer frame shape", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
  });

  it("flips from landscape to vertical mid-sitting without rebuilding the player", async () => {
    renderPlayer([
      playerItem("item-a", VIDEO_A, LANDSCAPE),
      playerItem("item-b", VIDEO_B, VERTICAL),
    ]);
    await startSitting();

    expect(frameShape()).toBe("landscape");
    const player = livePlayer();
    const iframeHost = frame().firstElementChild;

    // Past the first entry's ten seconds, so the second one is on screen.
    await playFor(12);

    expect(frameShape()).toBe("vertical");
    expect(screen.getByText("Title item-b")).toBeTruthy();
    // The frame is a class on a wrapper the iframe merely lives inside, so changing it
    // must cost the sitting nothing: same player object, never destroyed, never rebuilt,
    // in the same element it was built in.
    expect(livePlayer()).toBe(player);
    expect(player.destroyed).toBe(false);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
    expect(frame().firstElementChild).toBe(iframeHost);
    expect(player.loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 0 },
    ]);
  });

  it("opens on the shape of the entry the sitting starts with", () => {
    renderPlayer([playerItem("item-a", VIDEO_A, VERTICAL)]);

    expect(frameShape()).toBe("vertical");
    expect(frame().style.getPropertyValue("--frame-aspect")).toBe(String(VERTICAL));
  });

  it("draws an entry whose shape was never resolved as landscape", async () => {
    renderPlayer([playerItem("item-a", VIDEO_A, null)]);
    await startSitting();

    expect(frameShape()).toBe("landscape");
  });

  it("holds the shape of the entry the sitting ended on", async () => {
    renderPlayer([playerItem("item-a", VIDEO_A, VERTICAL)]);
    await startSitting();

    await playFor(12);

    expect(screen.getByText("Playback complete.")).toBeTruthy();
    expect(frameShape()).toBe("vertical");
  });

  // Media queries do not resolve in jsdom, so the breakpoint itself is asserted as the
  // classes that carry it: one element sized from its own height on a phone and handed
  // back to 16:9 at `sm`, never a second tree the iframe would have to move between.
  it("sizes the frame from its height on a phone and returns it to 16:9 at sm", () => {
    renderPlayer([playerItem("item-a", VIDEO_A, VERTICAL)]);

    const className = frame().className;
    expect(className).toContain("w-[calc(min(70vh,32rem)*var(--frame-aspect))]");
    expect(className).toContain("aspect-[var(--frame-aspect)]");
    expect(className).toContain("mx-auto");
    expect(className).toContain("sm:w-full");
    expect(className).toContain("sm:aspect-video");
  });
});
