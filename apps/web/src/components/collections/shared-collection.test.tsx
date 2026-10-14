// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SharedCollection } from "@/components/collections/shared-collection";
import {
  FakeYouTubePlayer,
  VIDEO_A,
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
  uninstallNativeFullscreen,
} from "@/test/fullscreen-fake";

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

function renderShared() {
  return render(
    <SharedCollection
      collection={makeCollection()}
      videoFacts={VIDEO_FACTS}
      updatedLabel="today"
    />,
  );
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

  it("restarts the sitting from the top while one is already running", async () => {
    renderShared();

    fireEvent.click(screen.getByRole("button", { name: /Play the whole collection/ }));
    await settle();
    await settle();

    await playFor(12);
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play from the top" }));
    await settle();
    await settle();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
    expect(FakeYouTubePlayer.instances).toHaveLength(2);
  });

  it("offers no Previous on the first entry and no Next on the last", async () => {
    renderShared();
    const isDisabled = (name: string) =>
      screen.getByRole("button", { name }).hasAttribute("disabled");

    fireEvent.click(screen.getByRole("button", { name: /Play the whole collection/ }));
    await settle();
    await settle();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(isDisabled("Previous entry")).toBe(true);
    expect(isDisabled("Next entry")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next entry" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next entry" }));
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
  fireEvent.click(screen.getByRole("button", { name: /Play the whole collection/ }));
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

    fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
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

  it("returns focus to the header toggle when the viewer leaves the browser's full screen", async () => {
    installNativeFullscreen();
    renderShared();
    await startSharedSitting();
    await pressFullscreenToggle();

    leaveNativeFullscreenFromBrowser();

    expect(document.activeElement).toBe(fullscreenToggle());
  });
});
