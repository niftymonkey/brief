"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { CircleAlert, Loader2, Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { entryAspectRatio } from "@/lib/collection-entries";
import { formatRange } from "@/lib/collection-item-input";
import {
  BOUNDARY_POLL_INTERVAL_MS,
  initialPlaybackState,
  readSittingPosition,
  reducePlayback,
  type PlaybackEffect,
  type PlaybackEvent,
  type PlaybackState,
  type SittingPosition,
} from "@/lib/collection-playback";
import { loadYouTubeIframeApi } from "@/lib/youtube-iframe-api";

export interface CollectionPlayerItem {
  id: string;
  videoId: string;
  videoTitle: string | null;
  summary: string | null;
  startSec: number | null;
  endSec: number | null;
  /** The video's frame shape as width divided by height, null when unknown. */
  aspectRatio: number | null;
}

/**
 * The two moves the header carries for a run it does not own. Prev and skip are the
 * only things outside the player that steer it; starting and stopping a run are the
 * page's own, because they mount and unmount this component.
 */
export interface CollectionPlayerHandle {
  skip: () => void;
  prev: () => void;
}

interface CollectionPlayerProps {
  items: CollectionPlayerItem[];
  /**
   * Where the run stands, reported on every change and as null once the player goes,
   * so the header's counter and the entries list follow the sitting.
   */
  onPositionChange?: (position: SittingPosition | null) => void;
  ref?: Ref<CollectionPlayerHandle>;
}

/**
 * One run of a collection as the page holding the player keeps it: the items exactly
 * as they stood when the viewer pressed play, and the key that identifies the run.
 *
 * The items are the host's own copy because the player sequences by index against the
 * list it was handed, while the page underneath it can add, reorder or remove entries.
 * A run reads its own frozen list, so an edit made mid-sitting changes the collection
 * without disturbing what is playing. The key changes per run, which is what makes a
 * restart rebuild the player rather than resume the run already in flight.
 */
export interface ActiveSitting {
  key: number;
  items: CollectionPlayerItem[];
}

function itemLabel(item: CollectionPlayerItem): string {
  return item.videoTitle ?? item.videoId;
}

/**
 * The entry whose shape the frame is drawn at, which is the one on screen wherever
 * there is one.
 *
 * Before the first load that is the entry the run opens on, so a sitting that starts
 * on a Short is laid out for it from the first paint instead of snapping out of 16:9
 * a moment later. Once the run is over it is the entry it ended on, so the still the
 * player leaves behind keeps the frame it was playing in.
 */
function frameItem(
  items: CollectionPlayerItem[],
  state: PlaybackState,
): CollectionPlayerItem | null {
  const playing = items[state.index];
  if (playing) return playing;
  return (state.index < 0 ? items[0] : items[items.length - 1]) ?? null;
}

/**
 * The frame's shape, published to the CSS as well as applied to the frame, because a
 * phone sizes a vertical frame from its own height and derives the width from this.
 */
interface FrameStyle extends CSSProperties {
  "--frame-aspect": string;
}

/**
 * Plays every item of a collection back to back, honoring each item's start and
 * end. Purely presentational with respect to data: it takes the items it should
 * play as props and fetches nothing, so a share page can mount the same component.
 *
 * The advance decisions live in `@/lib/collection-playback`; this component only
 * feeds that reducer real player events (a 200ms `getCurrentTime()` poll plus
 * `onStateChange` / `onError`) and performs the effects it asks for. It performs them
 * exactly as asked: a `seek` is what lets the reducer recognise a second range of the
 * video already on screen, and turning one into a reload would take that away.
 */
export function CollectionPlayer({ items, onPositionChange, ref }: CollectionPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const stateRef = useRef<PlaybackState>(initialPlaybackState());
  const failureTimerRef = useRef<number | null>(null);
  const armingTimerRef = useRef<number | null>(null);
  /**
   * The dispatch of the last committed render, for the work that outlives the render
   * which wired it up: the deferred advances scheduled below, and the player callbacks
   * and poll, which are installed once and then run for the life of the sitting.
   */
  const dispatchRef = useRef<(event: PlaybackEvent) => void>(() => {});

  const [state, setState] = useState<PlaybackState>(initialPlaybackState);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [apiFailed, setApiFailed] = useState(false);
  /** Bumped by the Try again control to build the player over from scratch. */
  const [loadAttempt, setLoadAttempt] = useState(0);

  const clearArmingTimer = useCallback(() => {
    if (armingTimerRef.current !== null) {
      window.clearTimeout(armingTimerRef.current);
      armingTimerRef.current = null;
    }
  }, []);

  const runEffects = useCallback(
    (effects: PlaybackEffect[]) => {
      for (const effect of effects) {
        const player = playerRef.current;
        switch (effect.kind) {
          case "load": {
            setAutoplayBlocked(false);
            // No `endSeconds`: the poll owns the boundary, and a player that stops
            // itself at one emits a terminal event that outlives the item it belongs to.
            player?.loadVideoById({
              videoId: effect.item.videoId,
              startSeconds: effect.item.startSec ?? 0,
            });
            break;
          }
          case "seek": {
            setAutoplayBlocked(false);
            // The video is already on screen, so moving it is both faster and the only
            // way the reducer can tell this item's playback from the one before it.
            player?.seekTo(effect.toSec, true);
            player?.playVideo();
            break;
          }
          case "play": {
            player?.playVideo();
            break;
          }
          case "pause": {
            // The sitting is over but the player stays mounted to offer Play again, so
            // nothing stops the video playing on under it unless we stop it.
            player?.pauseVideo();
            break;
          }
          case "scheduleFailureAdvance": {
            if (failureTimerRef.current !== null) {
              window.clearTimeout(failureTimerRef.current);
            }
            // The pause is deliberate: the unplayable item stays on screen long enough
            // to read before the sitting moves on.
            failureTimerRef.current = window.setTimeout(() => {
              failureTimerRef.current = null;
              dispatchRef.current({ kind: "failureAdvance", generation: effect.generation });
            }, effect.delayMs);
            break;
          }
          case "scheduleArmingTimeout": {
            clearArmingTimer();
            armingTimerRef.current = window.setTimeout(() => {
              armingTimerRef.current = null;
              dispatchRef.current({ kind: "armingTimeout", generation: effect.generation });
            }, effect.delayMs);
            break;
          }
          case "finish": {
            clearArmingTimer();
            if (failureTimerRef.current !== null) {
              window.clearTimeout(failureTimerRef.current);
              failureTimerRef.current = null;
            }
            break;
          }
        }
      }
    },
    [clearArmingTimer],
  );

  const dispatch = useCallback(
    (event: PlaybackEvent) => {
      const transition = reducePlayback(stateRef.current, event, items);
      stateRef.current = transition.state;
      setState(transition.state);
      // The watchdog only guards the window before an item starts; once it has, the
      // boundary detector owns the item.
      if (transition.state.armed) clearArmingTimer();
      runEffects(transition.effects);
    },
    [clearArmingTimer, items, runEffects],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useImperativeHandle(
    ref,
    () => ({
      skip: () => dispatch({ kind: "skip" }),
      prev: () => dispatch({ kind: "prev" }),
    }),
    [dispatch],
  );

  useEffect(() => {
    let mounted = true;
    const container = containerRef.current;

    function currentVideoId(player: YT.Player): string | null {
      try {
        return player.getVideoData().video_id ?? null;
      } catch {
        return null;
      }
    }

    async function initPlayer() {
      if (!container) return;
      try {
        await loadYouTubeIframeApi();
      } catch {
        if (mounted) setApiFailed(true);
        return;
      }
      if (!mounted || !window.YT) {
        return;
      }

      // The API replaces the element it is given with the iframe, so hand it a
      // throwaway host inside the container React owns.
      const host = document.createElement("div");
      host.id = `collection-player-${Date.now()}`;
      container.replaceChildren(host);

      playerRef.current = new window.YT.Player(host.id, {
        width: "100%",
        height: "100%",
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          // iOS keeps the player inline instead of hijacking the whole screen.
          playsinline: 1,
          autoplay: 0,
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            // The Play control that mounted this component is the sitting's one real
            // user gesture, which is also what lets the run play unmuted.
            dispatchRef.current({ kind: "start" });
          },
          onStateChange: (event) => {
            const player = playerRef.current;
            if (!player) return;
            dispatchRef.current({
              kind: "playerState",
              state: event.data,
              currentTime: player.getCurrentTime(),
              videoId: currentVideoId(player),
              duration: player.getDuration(),
            });
          },
          onError: (event) => {
            const player = playerRef.current;
            dispatchRef.current({
              kind: "playerError",
              code: event.data,
              videoId: player ? currentVideoId(player) : null,
            });
          },
          onAutoplayBlocked: () => {
            if (!mounted) return;
            // The item is waiting on the viewer's Resume, not failing to start, so
            // the watchdog must not march the sitting past it.
            clearArmingTimer();
            setAutoplayBlocked(true);
          },
        },
      });
    }

    void initPlayer();

    // The poll is the boundary's source of truth; onStateChange only corroborates.
    // It runs from the load onward, so the reducer can see a seek land and can see an
    // item that started and then stopped making progress.
    let sampledAt: number | null = null;
    const poll = window.setInterval(() => {
      const player = playerRef.current;
      const status = stateRef.current.status;
      if (!player || (status !== "loading" && status !== "playing")) return;
      const now = Date.now();
      // A backgrounded tab is handed this interval a fraction as often as it asked for,
      // so the watchdogs are told how long the sample really covers rather than
      // assuming the cadence they asked for.
      const sinceLastMs = now - (sampledAt ?? now - BOUNDARY_POLL_INTERVAL_MS);
      sampledAt = now;
      dispatchRef.current({
        kind: "tick",
        state: player.getPlayerState(),
        currentTime: player.getCurrentTime(),
        videoId: currentVideoId(player),
        duration: player.getDuration(),
        sinceLastMs,
      });
    }, BOUNDARY_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(poll);
      clearArmingTimer();
      if (failureTimerRef.current !== null) {
        window.clearTimeout(failureTimerRef.current);
        failureTimerRef.current = null;
      }
      playerRef.current?.destroy();
      playerRef.current = null;
      container?.replaceChildren();
      // A remounted player gets a clean sequence rather than inheriting a run
      // whose iframe no longer exists.
      stateRef.current = initialPlaybackState();
    };
  }, [clearArmingTimer, loadAttempt]);

  const position = readSittingPosition(state, items);
  const { itemId, ordinal, total, isDone } = position;

  useEffect(() => {
    onPositionChange?.({ itemId, ordinal, total, isDone });
  }, [itemId, ordinal, total, isDone, onPositionChange]);

  const reportPlaybackEnded = useEffectEvent(() => {
    onPositionChange?.(null);
  });

  useEffect(() => {
    // Runs on unmount only, so the row highlight is dropped when the player goes and at
    // no other time. Reaching the callback as an Effect Event is what holds that true
    // however a consumer builds the prop.
    return () => reportPlaybackEnded();
  }, []);

  const currentItem = state.index >= 0 ? (items[state.index] ?? null) : null;
  const range = currentItem ? formatRange(currentItem.startSec, currentItem.endSec) : "";

  const frameAspect = entryAspectRatio(frameItem(items, state)?.aspectRatio ?? null);
  const frameStyle: FrameStyle = { "--frame-aspect": String(frameAspect) };

  const handleRetryApi = () => {
    setApiFailed(false);
    setAutoplayBlocked(false);
    // Bumping the attempt rebuilds the player from scratch, so the sitting on screen
    // goes back to the top with it.
    setState(initialPlaybackState());
    setLoadAttempt((attempt) => attempt + 1);
  };

  const handleResume = () => {
    setAutoplayBlocked(false);
    playerRef.current?.playVideo();
  };

  return (
    <section aria-label="Collection playback">
      {/* One tree across both the entry change and the breakpoint: the shape is a
          class on a wrapper the iframe merely lives inside, and the phone's
          true-shape frame is the same element the desktop draws at 16:9. */}
      <div
        style={frameStyle}
        data-frame-shape={frameAspect < 1 ? "vertical" : "landscape"}
        className="relative w-[calc(min(70vh,32rem)*var(--frame-aspect))] max-w-full mx-auto aspect-[var(--frame-aspect)] sm:w-full sm:aspect-video rounded-lg sm:rounded-xl overflow-hidden bg-black"
      >
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      </div>

      {apiFailed && (
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <p role="alert" className="text-sm text-red-500">
            The YouTube player could not be loaded.
          </p>
          <Button size="sm" variant="outline" onClick={handleRetryApi}>
            <RotateCw className="w-4 h-4" />
            Try again
          </Button>
        </div>
      )}

      {autoplayBlocked && (
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your browser blocked playback from starting on its own.
          </p>
          <Button size="sm" onClick={handleResume}>
            <Play className="w-4 h-4" />
            Resume
          </Button>
        </div>
      )}

      {/* A fixed block whatever the entry's text runs to, so skipping never reflows
          the entries list underneath the player. */}
      <div className="mt-3.5">
        <div className="flex items-baseline gap-2 h-[1.4em]">
          <p className="min-w-0 truncate font-medium leading-[1.4] text-[var(--color-text-primary)]">
            {currentItem ? (
              itemLabel(currentItem)
            ) : isDone ? (
              "Playback complete."
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Starting playback…
              </span>
            )}
          </p>
          {range && (
            <span className="shrink-0 font-mono text-xs text-[var(--color-text-tertiary)]">
              {range}
            </span>
          )}
        </div>
        <p className="h-[3em] line-clamp-2 text-sm sm:text-[0.9375rem] leading-[1.5] text-[var(--color-text-secondary)]">
          {currentItem?.summary ?? ""}
        </p>
      </div>

      {state.failures.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {state.failures.map((failure) => {
            const failed = items.find((item) => item.id === failure.itemId);
            return (
              <li
                key={`${failure.itemId}-${failure.code}`}
                role="alert"
                className="flex items-start gap-2 text-sm text-red-500"
              >
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">
                    Could not play {failed ? itemLabel(failed) : "this item"}.
                  </span>{" "}
                  {failure.reason}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
