import { act } from "@testing-library/react";
import { vi } from "vitest";
import { BOUNDARY_POLL_INTERVAL_MS, PLAYER_STATE } from "@/lib/collection-playback";
import type { EntryVideoFacts } from "@/lib/collection-entries";
import type { CollectionItem, CollectionWithItems } from "@/lib/collections";

/** How long the fake player spends buffering before it reports it is playing. */
const LOAD_LATENCY_MS = 100;

export const VIDEO_A = "aaaaaaaaaaa";
export const VIDEO_B = "bbbbbbbbbbb";

export const VIDEO_DURATION_SEC: Record<string, number> = {
  [VIDEO_A]: 600,
  [VIDEO_B]: 600,
};

export type PlayerCall =
  | { kind: "load"; videoId: string; toSec: number }
  | { kind: "seek"; toSec: number }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "destroy" };

/**
 * A YouTube IFrame player a suite drives by hand: it records what the component
 * asked it to do, reports a clock that only moves while it is playing, and delivers
 * its callbacks on later tasks, the way the real API does.
 *
 * It is deliberately faithful about the two things the sequencer rests on: a load
 * buffers before it says it is playing, and a seek within the video already on
 * screen changes the clock without any state change at all.
 */
export class FakeYouTubePlayer {
  static instances: FakeYouTubePlayer[] = [];

  readonly calls: PlayerCall[] = [];
  destroyed = false;

  private readonly events: YT.PlayerEvents;
  private videoId: string | null = null;
  private position = 0;
  private playerState: number = PLAYER_STATE.UNSTARTED;

  constructor(_host: string | HTMLElement, options: YT.PlayerOptions) {
    this.events = options.events ?? {};
    FakeYouTubePlayer.instances.push(this);
    setTimeout(() => this.emitReady(), 0);
  }

  loadVideoById({ videoId, startSeconds }: YT.LoadVideoOptions): void {
    this.calls.push({ kind: "load", videoId, toSec: startSeconds ?? 0 });
    this.videoId = videoId;
    this.position = startSeconds ?? 0;
    this.playerState = PLAYER_STATE.BUFFERING;
    setTimeout(() => {
      this.playerState = PLAYER_STATE.PLAYING;
      this.emitStateChange();
    }, LOAD_LATENCY_MS);
  }

  cueVideoById(): void {}

  seekTo(seconds: number): void {
    this.calls.push({ kind: "seek", toSec: seconds });
    this.position = seconds;
  }

  playVideo(): void {
    this.calls.push({ kind: "play" });
    if (this.playerState === PLAYER_STATE.PLAYING || this.playerState === PLAYER_STATE.BUFFERING) {
      return;
    }
    this.playerState = PLAYER_STATE.PLAYING;
    this.emitStateChange();
  }

  pauseVideo(): void {
    this.calls.push({ kind: "pause" });
    this.playerState = PLAYER_STATE.PAUSED;
    this.emitStateChange();
  }

  stopVideo(): void {}
  mute(): void {}
  unMute(): void {}

  destroy(): void {
    this.calls.push({ kind: "destroy" });
    this.destroyed = true;
  }

  getCurrentTime(): number {
    return this.position;
  }

  getPlayerState(): number {
    return this.playerState;
  }

  getDuration(): number {
    return this.videoId ? (VIDEO_DURATION_SEC[this.videoId] ?? 0) : 0;
  }

  getVideoData(): YT.VideoData {
    return { video_id: this.videoId ?? undefined };
  }

  /** Moves the player's clock the way real playback would over `ms`. */
  advanceClock(ms: number): void {
    if (this.playerState !== PLAYER_STATE.PLAYING) return;
    this.position += ms / 1000;
  }

  /** What the component asked the player to put on screen, in order. */
  get loads(): PlayerCall[] {
    return this.calls.filter((call) => call.kind === "load" || call.kind === "seek");
  }

  get pauseCount(): number {
    return this.calls.filter((call) => call.kind === "pause").length;
  }

  private emitReady(): void {
    this.events.onReady?.({ target: this as unknown as YT.Player });
  }

  private emitStateChange(): void {
    this.events.onStateChange?.({
      target: this as unknown as YT.Player,
      data: this.playerState as YT.PlayerState,
    });
  }
}

/**
 * The window as a suite that installs and removes the API sees it. The global `YT`
 * namespace is declared unconditionally, so `window.YT` reads as always present; this
 * is the same object, described as what it is on a page the script has not reached.
 */
const apiHost: { YT?: typeof YT } = window;

/** Puts the fake behind `window.YT` and forgets the players a previous test built. */
export function installFakeYouTubePlayer(): void {
  FakeYouTubePlayer.instances = [];
  apiHost.YT = { Player: FakeYouTubePlayer } as unknown as typeof YT;
}

export function uninstallFakeYouTubePlayer(): void {
  FakeYouTubePlayer.instances = [];
  apiHost.YT = undefined;
}

/** Lets every pending microtask and zero-delay timer settle inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

/** Runs the sitting for `seconds` of wall clock, one poll interval at a time. */
export async function playFor(seconds: number): Promise<void> {
  const steps = Math.round((seconds * 1000) / BOUNDARY_POLL_INTERVAL_MS);
  for (let step = 0; step < steps; step += 1) {
    await act(async () => {
      for (const player of FakeYouTubePlayer.instances) {
        if (!player.destroyed) player.advanceClock(BOUNDARY_POLL_INTERVAL_MS);
      }
      await vi.advanceTimersByTimeAsync(BOUNDARY_POLL_INTERVAL_MS);
    });
  }
}

/** The player currently on screen, which a restart replaces with a fresh one. */
export function livePlayer(): FakeYouTubePlayer {
  for (let index = FakeYouTubePlayer.instances.length - 1; index >= 0; index -= 1) {
    const player = FakeYouTubePlayer.instances[index];
    if (!player.destroyed) return player;
  }
  throw new Error("No player was built");
}

export function makeItem(
  id: string,
  videoId: string,
  startSec: number | null,
  endSec: number | null,
  position: number,
): CollectionItem {
  return {
    id,
    videoId,
    startSec,
    endSec,
    videoTitle: `Title ${id}`,
    durationSec: VIDEO_DURATION_SEC[videoId],
    summary: null,
    summaryStatus: "ready",
    position,
  };
}

/**
 * Three entries where the last two are ranges of one video, which is the shape most
 * of the real collections have and the one where a shifted index would still be
 * accepted by the player's own id check.
 */
export function makeCollection(): CollectionWithItems {
  return {
    id: "collection-1",
    title: "A sitting",
    description: null,
    isShared: false,
    slug: null,
    itemCount: 3,
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [
      makeItem("item-a", VIDEO_A, 0, 10, 0),
      makeItem("item-b", VIDEO_B, 0, 10, 1),
      makeItem("item-c", VIDEO_B, 30, 40, 2),
    ],
  };
}

export const VIDEO_FACTS: Record<string, EntryVideoFacts> = {
  [VIDEO_A]: { title: "Video A", channelName: "Channel", durationSec: VIDEO_DURATION_SEC[VIDEO_A] },
  [VIDEO_B]: { title: "Video B", channelName: "Channel", durationSec: VIDEO_DURATION_SEC[VIDEO_B] },
};
