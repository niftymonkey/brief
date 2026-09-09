// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { YouTubePlayer } from "@/components/youtube-player";
import {
  FakeYouTubePlayer,
  VIDEO_A,
  VIDEO_B,
  installFakeYouTubePlayer,
  settle,
  uninstallFakeYouTubePlayer,
} from "@/test/collection-playback-harness";

/** The players built so far, in the order the component built them. */
function builtPlayers(): FakeYouTubePlayer[] {
  return FakeYouTubePlayer.instances;
}

/** Lets the API load promise and the fake's ready callback both land. */
async function ready(): Promise<void> {
  await settle();
  await settle();
}

describe("YouTubePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    uninstallFakeYouTubePlayer();
  });

  it("builds a player for the video and hands back a seek that drives it", async () => {
    const seeks: ((seconds: number) => void)[] = [];
    render(<YouTubePlayer videoId={VIDEO_A} title="A" onReady={(seek) => seeks.push(seek)} />);
    await ready();

    expect(builtPlayers()).toHaveLength(1);
    expect(seeks).toHaveLength(1);

    act(() => seeks[0](42));
    expect(builtPlayers()[0].calls).toEqual([{ kind: "seek", toSec: 42 }]);
  });

  it("replaces the player when the video changes", async () => {
    const { rerender } = render(<YouTubePlayer videoId={VIDEO_A} title="A" />);
    await ready();

    rerender(<YouTubePlayer videoId={VIDEO_B} title="B" />);
    await ready();

    expect(builtPlayers()).toHaveLength(2);
    expect(builtPlayers()[0].destroyed).toBe(true);
    expect(builtPlayers()[1].destroyed).toBe(false);
  });

  it("destroys the player when the video is closed", async () => {
    const { unmount } = render(<YouTubePlayer videoId={VIDEO_A} title="A" />);
    await ready();

    unmount();
    expect(builtPlayers()[0].destroyed).toBe(true);
  });

  it("does not report ready once the video has been closed", async () => {
    const onReady = vi.fn();
    const { unmount } = render(<YouTubePlayer videoId={VIDEO_A} title="A" onReady={onReady} />);
    // Unmounts inside the window between the player being built and its ready
    // callback arriving, which is where a late report would land.
    unmount();
    await ready();

    expect(onReady).not.toHaveBeenCalled();
  });

  it("reports ready to the callback from the latest render, not the first", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<YouTubePlayer videoId={VIDEO_A} title="A" onReady={first} />);
    // The player is already building when the parent swaps in a new callback, so the
    // ready report has to reach the callback the component was last rendered with.
    rerender(<YouTubePlayer videoId={VIDEO_A} title="A" onReady={second} />);
    await ready();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
