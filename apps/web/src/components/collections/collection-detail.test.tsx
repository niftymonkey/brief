// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

function detailElement(collection = makeCollection()) {
  return (
    <CollectionDetail
      collection={collection}
      editable
      videoFacts={VIDEO_FACTS}
      curator="Curator"
      updatedLabel="today"
      siteOrigin="https://example.test"
    />
  );
}

function renderDetail(collection = makeCollection()) {
  return render(detailElement(collection));
}

/** The stage column a wide screen draws the video, its caption and its transport in. */
function stage(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-collection-stage]");
  if (!element) throw new Error("No stage was rendered");
  return element;
}

/**
 * The header's control of this name. A wide screen carries a second set under the
 * stage, and media queries do not resolve here, so both are in the document.
 */
function headerButton(name: string | RegExp): HTMLElement {
  const button = screen
    .queryAllByRole("button", { name })
    .find((candidate) => !stage().contains(candidate));
  if (!button) throw new Error(`No header control named ${String(name)}`);
  return button;
}

function isDisabled(name: string): boolean {
  return headerButton(name).hasAttribute("disabled");
}

async function pressNext(): Promise<void> {
  fireEvent.click(headerButton("Next entry"));
  await settle();
}

/** The aria-describedby of every drag grip in one server render of the page. */
function serverRenderedGripDescriptions(): (string | null)[] {
  const container = document.createElement("div");
  container.innerHTML = renderToString(detailElement());
  return [...container.querySelectorAll('[aria-roledescription="sortable"]')].map((grip) =>
    grip.getAttribute("aria-describedby"),
  );
}

async function startSitting(): Promise<void> {
  fireEvent.click(headerButton(/Play the whole collection/));
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

function playerRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Collection playback" });
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
    expect(within(playerRegion()).getByText("Playback complete.")).toBeTruthy();
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
    expect(within(playerRegion()).getByText("Playback complete.")).toBeTruthy();
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
    expect(headerButton(/Play the whole collection/).hasAttribute("disabled")).toBe(false);
  });

  it("offers no closing Play from the top, idle or mid-run", async () => {
    renderDetail();
    expect(screen.queryByRole("button", { name: "Play from the top" })).toBeNull();

    await startSitting();
    await playFor(12);

    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play from the top" })).toBeNull();
  });

  it("ends at the add form, with no closing block after it", () => {
    renderDetail();

    expect(screen.queryByText(/Total runtime of/)).toBeNull();
    const addField = screen.getByLabelText("Add a video");
    const transport = document.querySelector("[data-collection-stage]")?.closest("section")?.parentElement;
    expect(transport?.lastElementChild?.contains(addField)).toBe(true);
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

    expect(headerButton("Stop playback")).toBeTruthy();
    expect(headerButton("Previous entry")).toBeTruthy();
    expect(headerButton("Next entry")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit collection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete collection" })).toBeTruthy();
  });

  it("steers the run from the header rather than from the player", async () => {
    renderDetail();
    await startSitting();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    fireEvent.click(headerButton("Next entry"));
    await settle();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    // The same player carried the sitting across, exactly as an entry boundary would.
    expect(FakeYouTubePlayer.instances).toHaveLength(1);

    fireEvent.click(headerButton("Previous entry"));
    await settle();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(livePlayer().loads).toEqual([
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
      { kind: "load", videoId: VIDEO_B, toSec: 0 },
      { kind: "load", videoId: VIDEO_A, toSec: 0 },
    ]);
  });

  it("offers no Previous on the first entry", async () => {
    renderDetail();
    await startSitting();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(true);
    expect(isDisabled("Next entry")).toBe(false);
  });

  it("offers both Previous and Next on an entry in the middle", async () => {
    renderDetail();
    await startSitting();
    await pressNext();

    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(false);
    expect(isDisabled("Next entry")).toBe(false);
  });

  it("offers no Next on the last entry, even when it is a second range of the video on screen", async () => {
    renderDetail();
    await startSitting();
    await pressNext();
    await pressNext();

    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(livePlayer().loads.at(-1)).toEqual({ kind: "seek", toSec: 30 });
    expect(isDisabled("Previous entry")).toBe(false);
    expect(isDisabled("Next entry")).toBe(true);
  });

  it("offers neither Previous nor Next in a collection of one entry", async () => {
    const collection = makeCollection();
    renderDetail({ ...collection, itemCount: 1, items: collection.items.slice(0, 1) });
    await startSitting();

    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(true);
    expect(isDisabled("Next entry")).toBe(true);
  });

  it("takes the player down from the one control that started it", async () => {
    renderDetail();
    await startSitting();
    expect(playerOnScreen()).toBe(true);

    fireEvent.click(headerButton("Stop playback"));
    await settle();

    expect(playerOnScreen()).toBe(false);
    expect(FakeYouTubePlayer.instances.every((player) => player.destroyed)).toBe(true);
    expect(headerButton(/Play the whole collection/)).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it("fills the viewport with the player from the header's full screen toggle", async () => {
    renderDetail();
    expect(screen.queryByRole("button", { name: "Enter full screen" })).toBeNull();
    await startSitting();

    fireEvent.click(headerButton("Enter full screen"));
    await settle();

    const frame = document.querySelector("[data-frame-shape]");
    expect(frame?.getAttribute("data-fullscreen")).toBe("fill");
    expect(document.body.style.overflow).toBe("hidden");
    expect(frame?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Exit full screen");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(frame?.hasAttribute("data-fullscreen")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(headerButton("Enter full screen"));
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

describe("CollectionDetail stage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body =
        init?.method === "POST" ? makeItem("item-d", VIDEO_A, 0, 10, 3) : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
  });

  it("cues the last entry left when the cued one is removed from the end", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Go to Title item-c" }));
    await settle();
    expect(within(stage()).getByText("03 of 03")).toBeTruthy();

    await removeEntry(2);

    expect(within(stage()).getByText("Title item-b")).toBeTruthy();
    expect(within(stage()).getByText("02 of 02")).toBeTruthy();

    fireEvent.click(within(stage()).getByRole("button", { name: /Play the whole collection/ }));
    await settle();
    await settle();
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_B, toSec: 0 }]);
  });

  it("keeps the cued entry on the stage when an entry above it is removed", async () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Go to Title item-b" }));
    await settle();
    expect(within(stage()).getByText("02 of 03")).toBeTruthy();

    await removeEntry(0);

    expect(within(stage()).getByText("Title item-b")).toBeTruthy();
    expect(within(stage()).queryByText("Title item-c")).toBeNull();
    expect(within(stage()).getByText("01 of 02")).toBeTruthy();
  });

  it("starts a new run from an entry added after the playing run began", async () => {
    renderDetail();
    await startSitting();
    await addEntry();
    expect(FakeYouTubePlayer.instances).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Go to Title item-d" }));
    await settle();
    await settle();

    expect(FakeYouTubePlayer.instances).toHaveLength(2);
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
    expect(screen.getByText("4 of 4")).toBeTruthy();
  });
});

describe("CollectionDetail server rendering", () => {
  it("describes the drag grips by the same id on every server render, so hydration matches", () => {
    // A long-lived server renders the page many times while each browser renders it
    // once, so an id that drifts between renders in one process cannot match the client.
    const first = serverRenderedGripDescriptions();
    const second = serverRenderedGripDescriptions();

    expect(first).toHaveLength(3);
    expect(first[0]).toBeTruthy();
    expect(second).toEqual(first);
  });
});
