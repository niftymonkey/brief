// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SharedCollection } from "@/components/collections/shared-collection";
import {
  FakeYouTubePlayer,
  VIDEO_A,
  VIDEO_B,
  VIDEO_FACTS,
  installFakeYouTubePlayer,
  livePlayer,
  makeCollection,
  playFor,
  settle,
  uninstallFakeYouTubePlayer,
} from "@/test/collection-playback-harness";
import {
  installNativeFullscreen,
  leaveNativeFullscreenFromBrowser,
  leaveNativeFullscreenLikeABrowser,
  uninstallNativeFullscreen,
} from "@/test/fullscreen-fake";

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

function renderShared(collection = makeCollection()) {
  return render(
    <SharedCollection
      collection={collection}
      videoFacts={VIDEO_FACTS}
      updatedLabel="today"
    />,
  );
}

/** The stage column a wide screen draws the video, its caption and its transport in. */
function stage(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-collection-stage]");
  if (!element) throw new Error("No stage was rendered");
  return element;
}

/** The clip's bar in the caption under the stage, as opposed to the one in the player's own caption. */
function stageCaptionSlider(): HTMLElement {
  const player = screen.getByRole("region", { name: "Collection playback" });
  const slider = within(stage())
    .getAllByRole("slider", { name: "Clip progress" })
    .find((candidate) => !player.contains(candidate));
  if (!slider) throw new Error("The stage caption is showing no clip bar");
  return slider;
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

describe("SharedCollection playback", () => {
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

  it("offers no closing Play from the top, idle or mid-run", async () => {
    renderShared();
    expect(screen.queryByRole("button", { name: "Play from the top" })).toBeNull();

    fireEvent.click(headerButton(/Play the whole collection/));
    await settle();
    await settle();
    await playFor(12);

    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play from the top" })).toBeNull();
  });

  it("offers no Previous on the first entry and no Next on the last", async () => {
    renderShared();
    const isDisabled = (name: string) => headerButton(name).hasAttribute("disabled");

    fireEvent.click(headerButton(/Play the whole collection/));
    await settle();
    await settle();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(true);
    expect(isDisabled("Next entry")).toBe(false);

    fireEvent.click(headerButton("Next entry"));
    await settle();
    fireEvent.click(headerButton("Next entry"));
    await settle();

    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(false);
    expect(isDisabled("Next entry")).toBe(true);
  });
});

/** The one element the iframe lives inside, which is what goes full screen. */
function frame(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-frame-shape]");
  if (!element) throw new Error("No frame was rendered");
  return element;
}

/** The header's toggle: the one full screen control that is not drawn inside the frame. */
function fullscreenToggle(): HTMLElement {
  const toggle = screen
    .queryAllByRole("button", { name: /full screen/ })
    .find((button) => document.querySelector("[data-frame-shape]")?.contains(button) !== true);
  if (!toggle) throw new Error("No full screen toggle was rendered");
  return toggle;
}

async function startSharedSitting(): Promise<void> {
  fireEvent.click(headerButton(/Play the whole collection/));
  await settle();
  await settle();
}

async function pressFullscreenToggle(): Promise<void> {
  fireEvent.click(fullscreenToggle());
  await settle();
}

describe("SharedCollection full screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
    uninstallNativeFullscreen();
    document.body.style.overflow = "";
  });

  it("offers full screen only while a sitting is on screen", async () => {
    renderShared();
    expect(screen.queryByRole("button", { name: /full screen/ })).toBeNull();

    await startSharedSitting();

    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("names the toggle for what it will do, with no pressed state to contradict it", async () => {
    renderShared();
    await startSharedSitting();
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
    expect(fullscreenToggle().hasAttribute("aria-pressed")).toBe(false);

    await pressFullscreenToggle();

    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Exit full screen");
    expect(fullscreenToggle().hasAttribute("aria-pressed")).toBe(false);
  });

  it("hands the frame to the browser's full screen where the browser has one", async () => {
    const requestFullscreen = installNativeFullscreen();
    renderShared();
    await startSharedSitting();

    await pressFullscreenToggle();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.contexts[0]).toBe(frame());
    expect(frame().getAttribute("data-fullscreen")).toBe("native");
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Exit full screen");
    // The browser draws the element over the page itself, so the page is not locked.
    expect(document.body.style.overflow).toBe("");
  });

  it("leaves the browser's full screen from the same toggle", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    await pressFullscreenToggle();

    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("follows the viewer out when they leave full screen through the browser", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Exit full screen");

    leaveNativeFullscreenFromBrowser();

    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("fills the viewport itself where the browser has no full screen", async () => {
    renderShared();
    await startSharedSitting();

    await pressFullscreenToggle();

    expect(frame().getAttribute("data-fullscreen")).toBe("fill");
    expect(frame().className).toContain("fixed");
    expect(frame().className).toContain("inset-0");
    expect(document.body.style.overflow).toBe("hidden");
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Exit full screen");
    // The header is under the filled frame, so the way out has to be inside it.
    expect(within(frame()).getByRole("button", { name: "Exit full screen" })).toBeTruthy();
  });

  it("fills the viewport itself when the browser refuses full screen", async () => {
    const requestFullscreen = installNativeFullscreen(() =>
      Promise.reject(new TypeError("Permissions check failed")),
    );
    renderShared();
    await startSharedSitting();

    await pressFullscreenToggle();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(frame().getAttribute("data-fullscreen")).toBe("fill");
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Exit full screen");
  });

  it("leaves the filled viewport on Escape", async () => {
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(within(frame()).queryByRole("button", { name: "Exit full screen" })).toBeNull();
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("keeps the clip's bar inside the frame in the browser's full screen and in the filled viewport", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();
    expect(frame().getAttribute("data-fullscreen")).toBe("native");
    expect(within(frame()).getByRole("slider", { name: "Clip progress" })).toBeTruthy();

    await pressFullscreenToggle();
    uninstallNativeFullscreen();
    await pressFullscreenToggle();
    expect(frame().getAttribute("data-fullscreen")).toBe("fill");
    expect(within(frame()).getByRole("slider", { name: "Clip progress" })).toBeTruthy();
  });

  it("leaves the filled viewport from the control drawn inside it", async () => {
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.click(within(frame()).getByRole("button", { name: "Exit full screen" }));

    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("keeps the sitting's one player through entering and leaving full screen", async () => {
    renderShared();
    await startSharedSitting();
    const player = livePlayer();
    const iframeHost = frame().firstElementChild;

    await pressFullscreenToggle();
    await pressFullscreenToggle();

    expect(livePlayer()).toBe(player);
    expect(player.destroyed).toBe(false);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
    expect(frame().firstElementChild).toBe(iframeHost);
  });

  it("releases the page when the sitting ends while the viewport is filled", async () => {
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.click(headerButton("Stop playback"));
    await settle();

    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByRole("button", { name: /full screen/ })).toBeNull();

    await startSharedSitting();
    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(fullscreenToggle().getAttribute("aria-label")).toBe("Enter full screen");
  });

  it("moves focus to the exit control inside the filled viewport", async () => {
    renderShared();
    await startSharedSitting();

    await pressFullscreenToggle();

    expect(document.activeElement).toBe(
      within(frame()).getByRole("button", { name: "Exit full screen" }),
    );
  });

  it("moves focus to the exit control inside the browser's full screen", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();

    await pressFullscreenToggle();

    expect(document.activeElement).toBe(
      within(frame()).getByRole("button", { name: "Exit full screen" }),
    );
  });

  it("returns focus to the header toggle when Escape leaves the filled viewport", async () => {
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.activeElement).toBe(fullscreenToggle());
  });

  it("returns focus to the header toggle when the control inside the frame leaves it", async () => {
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.click(within(frame()).getByRole("button", { name: "Exit full screen" }));

    expect(document.activeElement).toBe(fullscreenToggle());
  });

  it("returns focus to the header toggle when the control inside the browser's full screen leaves it", async () => {
    installNativeFullscreen();
    leaveNativeFullscreenLikeABrowser();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    fireEvent.click(within(frame()).getByRole("button", { name: "Exit full screen" }));
    await settle();

    expect(frame().hasAttribute("data-fullscreen")).toBe(false);
    expect(document.activeElement).toBe(fullscreenToggle());
  });

  it("returns focus to the header toggle when the viewer leaves the browser's full screen", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    leaveNativeFullscreenFromBrowser();

    expect(document.activeElement).toBe(fullscreenToggle());
  });
});

/** The still the stage shows while nothing plays. */
function stagePosterSrc(): string | null {
  return stage().querySelector("img")?.getAttribute("src") ?? null;
}

async function pressStagePlay(): Promise<void> {
  fireEvent.click(within(stage()).getByRole("button", { name: /Play the whole collection/ }));
  await settle();
  await settle();
}

async function goTo(title: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: `Go to ${title}` }));
  await settle();
}

// Media queries do not resolve in jsdom, so the wide-screen stage is in the document
// at every width here; what is asserted is what it shows and what its controls do.
describe("SharedCollection stage", () => {
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

  it("cues the first entry until a row says otherwise", () => {
    renderShared();

    expect(within(stage()).getByText("Title item-a")).toBeTruthy();
    expect(within(stage()).getByText("01 of 03")).toBeTruthy();
    expect(stagePosterSrc()).toContain(VIDEO_A);
    // The clip's bar and clock are for the entry playing, and nothing is.
    expect(within(stage()).queryByRole("slider")).toBeNull();
  });

  it("cues the entry whose row is pressed while nothing plays", async () => {
    renderShared();

    await goTo("Title item-c");

    expect(within(stage()).getByText("Title item-c")).toBeTruthy();
    expect(within(stage()).getByText("03 of 03")).toBeTruthy();
    expect(stagePosterSrc()).toContain(VIDEO_B);
    expect(FakeYouTubePlayer.instances).toHaveLength(0);
  });

  it("starts the run from the cued entry when the stage's Play is pressed", async () => {
    renderShared();
    await goTo("Title item-c");

    await pressStagePlay();

    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_B, toSec: 30 }]);
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(within(stage()).getByText("03 of 03")).toBeTruthy();
    expect(stageCaptionSlider()).toBeTruthy();
  });

  it("still starts from the top from the header's Play", async () => {
    renderShared();
    await goTo("Title item-c");

    await startSharedSitting();

    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
  });

  it("moves a playing run to the entry whose row is pressed, on the same player", async () => {
    renderShared();
    await startSharedSitting();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    await goTo("Title item-c");

    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
    expect(livePlayer().loads.at(-1)).toEqual({ kind: "load", videoId: VIDEO_B, toSec: 30 });
  });

  it("starts a new run from the pressed entry when the run cannot move there yet", async () => {
    renderShared();
    // Pressed before the player is ready, so the run has no entry on screen to move from.
    fireEvent.click(headerButton(/Play the whole collection/));

    await goTo("Title item-c");
    await settle();

    // The first run never put anything on screen; the one now playing opened on the row.
    expect(FakeYouTubePlayer.instances.flatMap((player) => player.loads)).toEqual([
      { kind: "load", videoId: VIDEO_B, toSec: 30 },
    ]);
    expect(screen.getByText("3 of 3")).toBeTruthy();
  });

  it("cues the entry that was on screen when the run is stopped", async () => {
    renderShared();
    await startSharedSitting();
    fireEvent.click(headerButton("Next entry"));
    await settle();
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.click(within(stage()).getByRole("button", { name: "Stop playback" }));
    await settle();

    expect(screen.queryByRole("region", { name: "Collection playback" })).toBeNull();
    expect(within(stage()).getByText("Title item-b")).toBeTruthy();
    expect(within(stage()).getByText("02 of 03")).toBeTruthy();
    expect(stagePosterSrc()).toContain(VIDEO_B);
  });

  it("steers the run from the transport under the stage", async () => {
    renderShared();
    await startSharedSitting();
    const isDisabled = (name: string) =>
      within(stage()).getByRole("button", { name }).hasAttribute("disabled");
    expect(isDisabled("Previous entry")).toBe(true);

    fireEvent.click(within(stage()).getByRole("button", { name: "Next entry" }));
    await settle();

    expect(screen.getByText("2 of 3")).toBeTruthy();
    // The player keeps a caption of its own for the narrow layout, inside the stage.
    const player = screen.getByRole("region", { name: "Collection playback" });
    const captions = within(stage())
      .getAllByText("Title item-b")
      .filter((node) => !player.contains(node));
    expect(captions).toHaveLength(1);
    expect(isDisabled("Previous entry")).toBe(false);
    expect(FakeYouTubePlayer.instances).toHaveLength(1);
  });

  it("ends at the section, with no closing block after it at any width", () => {
    const { container } = renderShared();

    expect(container.firstElementChild?.lastElementChild?.tagName).toBe("SECTION");
    expect(screen.queryByText(/Total runtime of/)).toBeNull();
  });
});

describe("SharedCollection clip titles", () => {
  /** The shared collection with its first clip carrying a title of its own. */
  const titledCollection = () => {
    const collection = makeCollection();
    collection.items[0] = { ...collection.items[0], title: "The clip's own title" };
    return collection;
  };

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

  it("shows a clip's own title on its row and on the stage", () => {
    renderShared(titledCollection());

    const rowTitles = [...document.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(rowTitles).toEqual(["The clip's own title", "Title item-b", "Title item-c"]);
    expect(within(stage()).getByText("The clip's own title")).toBeTruthy();
    expect(screen.queryByText("Title item-a")).toBeNull();
  });

  it("offers a reader no way to rename a clip", () => {
    renderShared(titledCollection());

    expect(screen.queryAllByRole("button", { name: /rename/i })).toEqual([]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
  });
});

describe("SharedCollection clip progress and the way out to YouTube", () => {
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

  /**
   * What every clip progress bar on the page reads, in seconds into the clip. The stage's
   * caption and the phone's caption both carry one, and media queries do not resolve
   * here, so both are in the document and both must agree.
   */
  function progressReadings(): number[] {
    return screen
      .getAllByRole("slider", { name: "Clip progress" })
      .map((bar) => Number(bar.getAttribute("aria-valuenow")));
  }

  async function pressNext(): Promise<void> {
    fireEvent.click(headerButton("Next entry"));
    await settle();
  }

  it("shows progress through the clip's own range, not through the whole video", async () => {
    // Slice 4 guarantee: progress is the position within the clip's range.
    renderShared();
    await startSharedSitting();
    // The third entry is 0:30 to 0:40 of a ten-minute video.
    await pressNext();
    await pressNext();
    await playFor(5);

    // The bar reads in seconds into the clip, out of the clip's ten.
    const expected = Math.round(livePlayer().getCurrentTime() - 30);
    expect(expected).toBeGreaterThan(4);
    expect(progressReadings()).toEqual([expected, expected]);
    for (const bar of screen.getAllByRole("slider", { name: "Clip progress" })) {
      expect(bar.getAttribute("aria-valuemax")).toBe("10");
    }
  });

  it("starts the progress over when the run moves to the next clip", async () => {
    // Slice 4 guarantee: progress resets per clip.
    renderShared();
    await startSharedSitting();
    await playFor(5);
    expect(progressReadings().every((reading) => reading >= 4)).toBe(true);

    await pressNext();

    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(progressReadings()).toEqual([0, 0]);
  });

  it("links out to the clip on screen at its start time, in a new tab", async () => {
    // Slice 5 guarantee: "Open in YouTube" is the current clip's video at its start.
    renderShared();
    await startSharedSitting();
    await pressNext();
    await pressNext();

    const links = screen.getAllByRole("link", { name: "Open in YouTube" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(`https://youtube.com/watch?v=${VIDEO_B}&t=30s`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});

/**
 * jsdom has no pointer events and no pointer capture. A PointerEvent built on its
 * MouseEvent carries the position and button the bar reads.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

describe("SharedCollection clip clock under the stage", () => {
  const pointerHost: { PointerEvent?: unknown } = window;
  const elementProto: Partial<Pick<HTMLElement, "setPointerCapture">> = HTMLElement.prototype;

  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
    pointerHost.PointerEvent = TestPointerEvent;
    elementProto.setPointerCapture = () => {};
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
    pointerHost.PointerEvent = undefined;
    elementProto.setPointerCapture = undefined;
  });

  /** Plays the run onto its third entry, 0:30 to 0:40 of a ten-minute video. */
  async function playThirdEntry(): Promise<void> {
    renderShared();
    await startSharedSitting();
    fireEvent.click(headerButton("Next entry"));
    await settle();
    fireEvent.click(headerButton("Next entry"));
    await settle();
  }

  /** The last place the run asked the player to seek to. */
  function lastSeek(): number | undefined {
    const seeks = livePlayer().calls.filter((call) => call.kind === "seek");
    const last = seeks.at(-1);
    return last?.kind === "seek" ? last.toSec : undefined;
  }

  it("reads the clip's place in the run on the left and its time against its length on the right", async () => {
    // Guarantee: the caption reads "03 of 03" and "0:0N / 0:10", live from the clip's own start.
    await playThirdEntry();
    await playFor(3);

    const caption = stageCaptionSlider().parentElement;
    if (!caption) throw new Error("The clip bar sits in no caption");
    const firstElapsed = Math.floor(livePlayer().getCurrentTime() - 30);
    expect(caption.firstElementChild?.textContent).toBe("03 of 03");
    expect(caption.lastElementChild?.textContent).toBe(`0:0${firstElapsed} / 0:10`);

    await playFor(3);
    const laterElapsed = Math.floor(livePlayer().getCurrentTime() - 30);
    expect(laterElapsed).toBeGreaterThan(firstElapsed);
    expect(caption.lastElementChild?.textContent).toBe(`0:0${laterElapsed} / 0:10`);
  });

  it("seeks where the bar is pressed and dragged, and never past either end of the clip", async () => {
    // Guarantee: seeking from the bar calls the player's seek, clamped to the clip's range.
    await playThirdEntry();
    await playFor(1);
    const bar = stageCaptionSlider();
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 0, width: 200, height: 12 }),
    );

    fireEvent.pointerDown(bar, { clientX: 200, button: 0, pointerId: 1 });
    expect(lastSeek()).toBe(35);

    fireEvent.pointerMove(bar, { clientX: 500, pointerId: 1 });
    expect(lastSeek()).toBe(40);

    fireEvent.pointerMove(bar, { clientX: 0, pointerId: 1 });
    expect(lastSeek()).toBe(30);

    fireEvent.pointerUp(bar, { clientX: 0, pointerId: 1 });
    const seeksAtRelease = livePlayer().calls.length;
    fireEvent.pointerMove(bar, { clientX: 250, pointerId: 1 });
    expect(livePlayer().calls.length).toBe(seeksAtRelease);
  });

  it("nudges playback by arrow key, held inside the clip", async () => {
    // Guarantee: seeking from the bar calls the player's seek, clamped to the clip's range.
    await playThirdEntry();
    await playFor(1);
    const bar = stageCaptionSlider();

    fireEvent.keyDown(bar, { key: "Home" });
    expect(lastSeek()).toBe(30);
    expect(bar.getAttribute("aria-valuenow")).toBe("0");

    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(lastSeek()).toBe(30);

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(lastSeek()).toBe(35);
    expect(bar.getAttribute("aria-valuenow")).toBe("5");

    fireEvent.keyDown(bar, { key: "ArrowRight" });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(lastSeek()).toBe(40);
  });

  it("ends a drag when the run moves to another clip, so one drag never seeks inside the next clip", async () => {
    renderShared();
    await startSharedSitting();
    await playFor(1);
    const bar = stageCaptionSlider();
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 0, width: 200, height: 12 }),
    );
    fireEvent.pointerDown(bar, { clientX: 200, button: 0, pointerId: 1 });

    fireEvent.click(headerButton("Next entry"));
    await settle();
    await playFor(1);
    const seeksAtClipChange = livePlayer().calls.filter((call) => call.kind === "seek").length;

    fireEvent.pointerMove(stageCaptionSlider(), { clientX: 250, pointerId: 1 });

    expect(livePlayer().calls.filter((call) => call.kind === "seek").length).toBe(seeksAtClipChange);
  });
});
