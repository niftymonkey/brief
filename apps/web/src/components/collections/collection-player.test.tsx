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
  return render(<CollectionPlayer items={items} onClose={() => {}} />);
}

/** The shape the frame holding the iframe is currently drawn at. */
function frameShape(): string | null {
  return document.querySelector("[data-frame-shape]")?.getAttribute("data-frame-shape") ?? null;
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

    // Past the first entry's ten seconds, so the second one is on screen.
    await playFor(12);

    expect(frameShape()).toBe("vertical");
    expect(screen.getByText("Playing 2 of 2")).toBeTruthy();
    // The frame is a class on a wrapper the iframe merely lives inside, so changing it
    // must cost the sitting nothing: same player object, never destroyed, never rebuilt.
    expect(livePlayer()).toBe(player);
    expect(player.destroyed).toBe(false);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
    expect(player.loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 0 },
    ]);
  });

  it("opens on the shape of the entry the sitting starts with", () => {
    renderPlayer([playerItem("item-a", VIDEO_A, VERTICAL)]);

    expect(frameShape()).toBe("vertical");
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
});
