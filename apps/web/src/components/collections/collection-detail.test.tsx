// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CollectionDetail } from "@/components/collections/collection-detail";
import {
  FakeYouTubePlayer,
  VIDEO_A,
  VIDEO_B,
  VIDEO_FACTS,
  installFakeYouTubePlayer,
  livePlayer,
  makeCollection,
  makeItem,
  playFor,
  settle,
  uninstallFakeYouTubePlayer,
} from "@/test/collection-playback-harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

function renderDetail() {
  return render(
    <CollectionDetail
      collection={makeCollection()}
      editable
      videoFacts={VIDEO_FACTS}
      curator="Curator"
      updatedLabel="today"
      siteOrigin="https://example.test"
    />,
  );
}

async function startSitting(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Play the whole collection/ }));
  await settle();
  await settle();
}

async function removeEntry(index: number): Promise<void> {
  const removeControls = screen.getAllByRole("button", { name: "Remove from collection" });
  await act(async () => {
    fireEvent.click(removeControls[index]);
  });
  await settle();
}

/** Clicks Remove on every entry on screen before any of the requests can settle. */
async function removeEveryRemainingEntry(): Promise<void> {
  const removeControls = screen.getAllByRole("button", { name: "Remove from collection" });
  await act(async () => {
    for (const control of removeControls) fireEvent.click(control);
  });
  await settle();
}

async function addEntry(): Promise<void> {
  fireEvent.change(screen.getByLabelText("Add a video"), {
    target: { value: `https://www.youtube.com/watch?v=${VIDEO_B}` },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
  });
  await settle();
}

function activeEntryIds(): string[] {
  return [...document.querySelectorAll('[aria-current="true"]')].map((node) => node.id);
}

function playerOnScreen(): boolean {
  return screen.queryByRole("region", { name: "Collection playback" }) !== null;
}

describe("CollectionDetail playback while the collection is edited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
    // A POST is the add path, which reads a stored item back off the response; every
    // other verb the page uses only needs an ok status.
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body =
        init?.method === "POST" ? makeItem("item-d", VIDEO_B, 0, 10, 3) : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
  });

  it("plays the sitting through after the entry on screen is deleted", async () => {
    renderDetail();
    await startSitting();

    await playFor(4);
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);

    await removeEntry(0);
    await playFor(45);

    expect(livePlayer().loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 0 },
      { kind: "seek", toSec: 30 },
    ]);
    expect(livePlayer().pauseCount).toBeGreaterThan(0);
    expect(screen.getByText("Playback complete.")).toBeTruthy();
  });

  it("lights the row again once the sitting reaches an entry the collection still holds", async () => {
    renderDetail();
    await startSitting();

    await playFor(4);
    await removeEntry(0);
    // The entry the player is on is gone from the collection, so nothing in the list
    // is the sitting's current entry any more.
    expect(activeEntryIds()).toEqual([]);

    // Long enough for the first entry's ten seconds to run out and the second to arm.
    await playFor(12);
    expect(activeEntryIds()).toEqual(["entry-1"]);
  });

  it("keeps the sitting running when an entry it has already passed is deleted", async () => {
    renderDetail();
    await startSitting();

    // Past the first two entries, so the player sits on the last one.
    await playFor(23);
    expect(livePlayer().loads).toHaveLength(3);

    await removeEntry(0);
    await playFor(30);

    expect(livePlayer().pauseCount).toBeGreaterThan(0);
    expect(screen.getByText("Playback complete.")).toBeTruthy();
    expect(screen.queryByText(/Starting playback/)).toBeNull();
  });

  it("takes the player down when the removals that empty the collection overlap", async () => {
    renderDetail();
    await startSitting();

    await playFor(4);
    await removeEntry(0);

    // Both removals are in flight before either request settles, so neither one can
    // see itself as the removal that leaves the collection empty.
    await removeEveryRemainingEntry();

    expect(screen.getByText("No entries yet")).toBeTruthy();
    expect(playerOnScreen()).toBe(false);
    expect(FakeYouTubePlayer.instances.every((player) => player.destroyed)).toBe(true);

    // Long enough for the whole frozen run to have played itself out had it survived.
    await playFor(30);
    expect(playerOnScreen()).toBe(false);
  });

  it("keeps the player off screen once the emptied collection is filled again", async () => {
    renderDetail();
    await startSitting();

    await playFor(4);
    await removeEntry(0);
    await removeEveryRemainingEntry();

    await addEntry();

    expect(screen.queryByText("No entries yet")).toBeNull();
    expect(playerOnScreen()).toBe(false);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);

    await playFor(5);
    expect(playerOnScreen()).toBe(false);
    expect(screen.getByRole("button", { name: "Play from the top" })).toBeTruthy();
  });

  it("restarts the sitting from the top while one is already running", async () => {
    renderDetail();
    await startSitting();

    await playFor(12);
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play from the top" }));
    await settle();
    await settle();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
    expect(FakeYouTubePlayer.instances).toHaveLength(2);
  });
});

describe("CollectionDetail header controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
  });

  it("offers the run's controls beside the collection's own, and only while it runs", async () => {
    renderDetail();

    expect(screen.queryByRole("button", { name: "Next entry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share collection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit collection" })).toBeTruthy();

    await startSitting();

    expect(screen.getByRole("button", { name: "Stop playback" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous entry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next entry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit collection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete collection" })).toBeTruthy();
  });

  it("steers the run from the header rather than from the player", async () => {
    renderDetail();
    await startSitting();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next entry" }));
    await settle();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    // The same player carried the sitting across, exactly as an entry boundary would.
    expect(FakeYouTubePlayer.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Previous entry" }));
    await settle();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(livePlayer().loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 0 },
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
    ]);
  });

  it("takes the player down from the one control that started it", async () => {
    renderDetail();
    await startSitting();
    expect(playerOnScreen()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
    await settle();

    expect(playerOnScreen()).toBe(false);
    expect(FakeYouTubePlayer.instances.every((player) => player.destroyed)).toBe(true);
    expect(screen.getByRole("button", { name: /Play the whole collection/ })).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it("reorders entries by dragging them, with no move buttons left to press", () => {
    renderDetail();

    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();

    // dnd-kit gives the grip its own role description, which is what a screen
    // reader announces in place of the two buttons this replaced.
    const grips = document.querySelectorAll('[aria-roledescription="sortable"]');
    expect(grips).toHaveLength(3);
    expect(grips[0]?.getAttribute("tabindex")).toBe("0");
  });
});
