// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef, type RefObject } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createClipProgress } from "@/lib/clip-progress";
import {
  CollectionPlayer,
  type CollectionPlayerHandle,
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
    title: null,
    videoTitle: `Title ${id}`,
    summary: null,
    startSec: 0,
    endSec: 10,
    aspectRatio,
  };
}

function renderPlayer(items: CollectionPlayerItem[]) {
  return render(<CollectionPlayer items={items} progress={createClipProgress()} />);
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

  it("opens on the shape of the entry the run is asked to start from", () => {
    render(
      <CollectionPlayer
        items={[playerItem("item-a", VIDEO_A, LANDSCAPE), playerItem("item-b", VIDEO_B, VERTICAL)]}
        startIndex={1}
        progress={createClipProgress()}
      />,
    );

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

describe("CollectionPlayer caption", () => {
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

  it("captions a clip with its own title, in place of the video's name", async () => {
    renderPlayer([{ ...playerItem("item-a", VIDEO_A, LANDSCAPE), title: "The clip's own title" }]);
    await startSitting();

    expect(screen.getByText("The clip's own title")).toBeTruthy();
    expect(screen.queryByText("Title item-a")).toBeNull();
  });

  it("captions a clip with no title of its own with the video's name", async () => {
    renderPlayer([playerItem("item-a", VIDEO_A, LANDSCAPE)]);
    await startSitting();

    expect(screen.getByText("Title item-a")).toBeTruthy();
  });
});

describe("CollectionPlayer starting point and jumps", () => {
  const ITEMS: CollectionPlayerItem[] = [
    playerItem("item-a", VIDEO_A, LANDSCAPE),
    playerItem("item-b", VIDEO_B, LANDSCAPE),
    { ...playerItem("item-c", VIDEO_B, LANDSCAPE), startSec: 30, endSec: 40 },
  ];

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

  function renderWithHandle(startIndex?: number): RefObject<CollectionPlayerHandle | null> {
    const handle = createRef<CollectionPlayerHandle>();
    render(<CollectionPlayer
        items={ITEMS}
        startIndex={startIndex}
        progress={createClipProgress()}
        ref={handle}
      />);
    return handle;
  }

  function jumpTo(handle: RefObject<CollectionPlayerHandle | null>, itemId: string): boolean {
    let moved = false;
    act(() => {
      moved = handle.current?.jumpTo(itemId) ?? false;
    });
    return moved;
  }

  it("starts the run on the entry it is asked to start from", async () => {
    renderWithHandle(1);
    await startSitting();

    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_B, toSec: 0 }]);
  });

  it("moves a live run to the entry asked for, in the player already built", async () => {
    const handle = renderWithHandle();
    await startSitting();
    const player = livePlayer();

    expect(jumpTo(handle, "item-c")).toBe(true);
    await playFor(1);

    expect(screen.getByText("Title item-c")).toBeTruthy();
    expect(player.loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 30 },
    ]);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
    expect(player.destroyed).toBe(false);
  });

  it("carries on from the entry it jumped to", async () => {
    const handle = renderWithHandle();
    await startSitting();

    jumpTo(handle, "item-b");
    // Past item-b's ten seconds, so the run has moved on to the entry after it.
    await playFor(12);

    expect(screen.getByText("Title item-c")).toBeTruthy();
    expect(livePlayer().loads.at(-1)).toEqual({ kind: "seek", toSec: 30 });
  });

  it("says so when the run does not hold the entry, so the page can start one that does", async () => {
    const handle = renderWithHandle();
    await startSitting();

    expect(jumpTo(handle, "not-in-this-run")).toBe(false);
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
  });

  it("says so when the run has not started yet, so the page can start one from the entry", () => {
    const handle = renderWithHandle();

    expect(jumpTo(handle, "item-c")).toBe(false);
  });
});

describe("CollectionPlayer lock to the clip", () => {
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

  it("builds the player with YouTube's own controls and keyboard shortcuts on", async () => {
    // Guarantee: YouTube's controls stay available, so captions and volume are in reach.
    renderPlayer([playerItem("item-a", VIDEO_A, LANDSCAPE)]);
    await startSitting();

    expect(livePlayer().playerVars.controls).toBe(1);
    expect(livePlayer().playerVars.disablekb).toBeUndefined();
  });

  it("leaves the video open to the pointer, with nothing laid over it", async () => {
    // Guarantee: YouTube's controls take clicks and focus, so no layer covers the iframe.
    renderPlayer([playerItem("item-a", VIDEO_A, LANDSCAPE)]);
    await startSitting();
    await playFor(1);

    const iframeHost = frame().querySelector("[id^='collection-player-']");
    if (!iframeHost) throw new Error("No iframe host was built");
    expect(iframeHost.closest("[inert]")).toBeNull();
    expect(within(frame()).queryByRole("button", { name: /video$/ })).toBeNull();
  });

  it("pulls playback moved before the clip's start back to the start", async () => {
    // Guarantee: a seek before the clip's range, from any control, snaps to the clip's start.
    renderPlayer([{ ...playerItem("item-a", VIDEO_A, LANDSCAPE), startSec: 20, endSec: 40 }]);
    await startSitting();
    await playFor(1);
    const player = livePlayer();

    player.seekTo(5);
    await playFor(1);

    expect(player.calls.filter((call) => call.kind === "seek").at(-1)).toEqual({ kind: "seek", toSec: 20 });
    expect(player.getCurrentTime()).toBeGreaterThanOrEqual(20);
  });

  it("ends the clip when playback is moved past its end", async () => {
    // Guarantee: a seek past the clip's range behaves as the clip ending.
    renderPlayer([
      { ...playerItem("item-a", VIDEO_A, LANDSCAPE), startSec: 20, endSec: 40 },
      playerItem("item-b", VIDEO_B, LANDSCAPE),
    ]);
    await startSitting();
    await playFor(1);
    const player = livePlayer();

    player.pauseVideo();
    player.seekTo(55);
    await playFor(1);

    expect(player.loads.at(-1)).toMatchObject({ kind: "load", videoId: VIDEO_B });
  });

  it("holds the video still when YouTube's own Play is pressed after the sitting has finished", async () => {
    // Guarantee: a finished sitting plays nothing past its last clip's end.
    renderPlayer([playerItem("item-a", VIDEO_A, LANDSCAPE)]);
    await startSitting();
    await playFor(12);
    expect(screen.getByText("Playback complete.")).toBeTruthy();
    const player = livePlayer();

    player.playVideo();
    await settle();

    expect(player.calls.at(-1)).toEqual({ kind: "pause" });
  });

  it("moves the clip's bar to where a paused viewer seeks with YouTube's own controls", async () => {
    // Guarantee: the clip bar and clock follow a seek made while paused, from any control.
    renderPlayer([{ ...playerItem("item-a", VIDEO_A, LANDSCAPE), startSec: 20, endSec: 40 }]);
    await startSitting();
    await playFor(1);
    const player = livePlayer();

    player.pauseVideo();
    await settle();
    player.seekTo(35);
    await playFor(1);

    expect(screen.getByRole("slider", { name: "Clip progress" }).getAttribute("aria-valuenow")).toBe("15");
  });
});
