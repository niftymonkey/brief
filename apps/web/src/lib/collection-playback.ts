/**
 * Pure sequencing logic behind continuous collection playback.
 *
 * The component around it owns the YouTube IFrame player; this module owns every
 * decision about when to advance, which is where the spike in
 * `spikes/clip-playback-117/FINDINGS.md` found the real hazards.
 *
 * The model is the spike's, and its one load-bearing rule is that an entry becomes
 * eligible to advance only once the player has proved that entry is the thing on
 * screen. Proof is never one signal: a callback is not a coherent reading of the
 * player. Its position is read when it fires, while the video id and length beside it
 * are read when it is delivered, which the spike logged as the outgoing entry's clock
 * arriving with the incoming entry's id. So an id alone proves nothing, and a load is
 * proved only by a `PLAYING` callback that both names this entry's video and lands
 * where the load asked the player to go.
 *
 * - A different video: the id rules out the entries around this one, and the landing
 *   position rules out a callback the previous entry fired on its way out.
 * - A second range of the video already on screen: no id changes, and a player that
 *   never leaves `PLAYING` fires no state change at all, so the only proof left is our
 *   own `seekTo`, corroborated by the first sample that lands on the position we asked
 *   for. Nothing the previous range does can produce that sample except where the two
 *   positions coincide, which is the contiguous case, where the player is already
 *   exactly where this entry wanted it.
 *
 * Until an entry is armed, every terminal event on the wire belongs to the entry
 * before it and is ignored: a previous range's `ENDED` lands after the next load is
 * already issued, and fresh loads emit a spurious `ENDED t=0`. Both silently skipped
 * entries in the spike's first build. Once armed, an entry is still only ended by a
 * reading that could have come from the video on screen: the player cannot be past the
 * end of a video it has not finished, so a length it reports beside a position rules
 * out both of those events on its own.
 *
 * Advancing is one-shot per load: it bumps `generation` and clears `armed`, so the
 * next event has nothing left to act on. Every deferred effect carries the generation
 * of the load that asked for it.
 *
 * Once armed, the poll owns the end boundary. No `endSeconds` is handed to the player,
 * so the player never stops itself mid-collection and there are no boundary-terminal
 * events to arrive late and be misread; the cost is that an entry runs past its own end
 * by the poll's own cadence, a second or so of it once a hidden tab throttles the poll,
 * which is the bound the sweep holds every scenario to rather than a hope. A
 * poll sample is the one coherent reading of the player there is, since its position,
 * id, length and state are all read at the same instant, so it is also the only thing
 * that ends an entry whose identity rests on a position rather than an id.
 *
 * These hazards interact, and the combinations that drop an entry are not the ones
 * anyone writes an example test for. `collection-playback-sweep.test.ts` runs a
 * modelled player through every combination of them against a set of collection
 * shapes and asserts that every entry renders its own range; changes here answer to it.
 */

export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** How long an unplayable item stays on screen before the sitting moves on. */
export const FAILURE_ADVANCE_DELAY_MS = 1600;

/**
 * How long a loaded item has to prove it is on screen before the sitting gives up on
 * it. Long enough to cover a cold load plus buffering on a slow connection, short
 * enough that a viewer is not left staring at a player that will never start.
 */
export const ARMING_TIMEOUT_MS = 12_000;

/** Poll cadence for the boundary detector, inside the spike's 150-250ms window. */
export const BOUNDARY_POLL_INTERVAL_MS = 200;

/**
 * What a backgrounded tab clamps the poll to. Nothing sets this: it is what browsers
 * do to `setInterval` in a hidden tab, and both the landing window and the watchdogs
 * have to hold when the poll is this much slower than it asked to be.
 */
export const THROTTLED_POLL_INTERVAL_MS = 1000;

/**
 * How long an item that started playing may report no forward progress before the
 * sitting treats it as stuck. A viewer's own pause is exempt: a paused sitting is
 * waiting for the viewer, not stalled.
 */
export const STALL_TIMEOUT_MS = 12_000;

/**
 * How long a player that says it is buffering may keep saying so. A player reporting
 * `BUFFERING` is telling us it is still working on this item, and a rebuffer on a poor
 * connection routinely outlasts the stall window, so a frozen clock means much less
 * here than under a player claiming to be playing. Half a minute is the point past
 * which the item is not coming back and the viewer would rather be moved on.
 */
export const REBUFFER_TIMEOUT_MS = 30_000;

/**
 * Failure code for an item the player never started or stopped making progress on, as
 * opposed to one the player rejected. Outside the YouTube IFrame API's own `onError`
 * codes, which are positive.
 */
export const STALLED_ERROR_CODE = -1;

/**
 * The most one poll sample may credit a watchdog with, however long the gap before it
 * was. A sample says the player's clock was frozen when it was read, not that it stayed
 * frozen across a gap the tab spent suspended, so a machine coming back from sleep owes
 * the sitting one interval and not the whole nap.
 */
const MAX_SAMPLE_CREDIT_MS = 2 * THROTTLED_POLL_INTERVAL_MS;

/** Forward movement between two samples that counts as the player still running. */
const PROGRESS_EPSILON_SEC = 0.05;

/**
 * How far behind the requested position a load may land and still corroborate it.
 * `seekTo` and `startSeconds` both snap to the nearest keyframe, which can sit
 * slightly before the target.
 */
const LANDING_BEHIND_SEC = 0.25;

/**
 * How far past the requested position a callback may sit and still be this load's
 * landing. A callback's position is read the moment it fires, which is the moment the
 * load landed, so the window only has to cover the keyframe the player really started
 * from.
 */
const EVENT_LANDING_AHEAD_SEC = 0.75;

/**
 * How far past the requested position a poll sample may sit and still be this load's
 * landing. The poll reads the player after the landing rather than at it, so the window
 * has to cover an interval of playback, and a hidden tab's interval at that, or a seek
 * in a backgrounded tab would never be corroborated at all.
 */
const POLL_LANDING_AHEAD_SEC = (THROTTLED_POLL_INTERVAL_MS + BOUNDARY_POLL_INTERVAL_MS) / 1000;

/**
 * How close to the loaded video's real end a stopped player has to sit before it
 * counts as parked there rather than stopped by the viewer. `getCurrentTime()` and
 * `getDuration()` disagree by a fraction of a second at the end of a video; wider than
 * that and a viewer who pauses to look at something in the closing seconds is read as
 * a video that ran out.
 */
const VIDEO_END_TOLERANCE_SEC = 0.25;

export interface PlaybackItem {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
}

export interface PlaybackFailure {
  itemId: string;
  index: number;
  code: number;
  reason: string;
}

export type PlaybackStatus = "idle" | "loading" | "playing" | "failed" | "done";

/**
 * How the current item was put on screen. A `seek` moved the video that was already
 * there, so it shares an id with the range before it and only a position tells the two
 * apart; a `load` replaced the video, so the id discriminates as well.
 */
export type LoadKind = "load" | "seek";

export interface PlaybackState {
  status: PlaybackStatus;
  /** Index of the item the player is on; -1 while idle, items.length once done. */
  index: number;
  /** Bumped on every load, stop and finish, so deferred work can detect staleness. */
  generation: number;
  /** True once the current load has proved it is what the player is showing. */
  armed: boolean;
  /** The video the last load put on screen, which decides load against seek. */
  loadedVideoId: string | null;
  /** How the current item was issued, or null when nothing is loaded. */
  loadKind: LoadKind | null;
  /**
   * The position this load asked the player to be at. Every load has one, and a sample
   * that does not sit on it is not this load's own, whatever id it carries.
   */
  landingTarget: number | null;
  /** The most recent position accepted as this load's own, for the stall watchdog. */
  lastPosition: number | null;
  /** How long this load has been watched without its clock moving forward. */
  stalledMs: number;
  /**
   * True once the poll has seen this player buffering, until its clock moves again or
   * a new load clears it. A player that says it is buffering is working on this item,
   * which is what both watchdogs use to tell a slow item from a dead one.
   */
  seenBuffering: boolean;
  /** How long the arming watchdog has already waited on this load. */
  armingWaitedMs: number;
  failures: PlaybackFailure[];
}

export type PlaybackEffect =
  /** Put a different video on screen at this item's start. */
  | { kind: "load"; index: number; item: PlaybackItem; generation: number }
  /** Move the video already on screen to this item's start. */
  | { kind: "seek"; index: number; item: PlaybackItem; generation: number; toSec: number }
  | { kind: "play" }
  /** Silence the player: the sitting is over and nothing more of it should be heard. */
  | { kind: "pause" }
  | { kind: "scheduleFailureAdvance"; generation: number; delayMs: number }
  | { kind: "scheduleArmingTimeout"; generation: number; delayMs: number }
  | { kind: "finish" };

export type PlaybackEvent =
  /** The one real user gesture that opens the sitting. */
  | { kind: "start" }
  | {
      kind: "playerState";
      state: number;
      currentTime: number;
      /**
       * The video the player names, as `getVideoData().video_id` reports it. Null when
       * the player would not answer, which is what it does mid-swap. Absent only from
       * a caller that does not report ids at all.
       */
      videoId?: string | null;
      /** The loaded video's real length, as `getDuration()` reports it. */
      duration?: number | null;
    }
  | {
      kind: "tick";
      state: number;
      currentTime: number;
      videoId?: string | null;
      duration?: number | null;
      /**
       * How long since the poll's previous sample. A hidden tab stretches it, which is
       * the difference between a watchdog measured in seconds and one measured in
       * samples. Absent from a caller polling at `BOUNDARY_POLL_INTERVAL_MS`.
       */
      sinceLastMs?: number;
    }
  | { kind: "playerError"; code: number; videoId?: string | null }
  | { kind: "failureAdvance"; generation: number }
  | { kind: "armingTimeout"; generation: number }
  | { kind: "skip" }
  /** Back one entry, and back to the top of the first one where there is no earlier. */
  | { kind: "prev" }
  | { kind: "stop" };

export interface PlaybackTransition {
  state: PlaybackState;
  effects: PlaybackEffect[];
}

const ERROR_REASONS: Record<number, string> = {
  [STALLED_ERROR_CODE]: "This item stopped playing and could not be recovered.",
  2: "Brief asked for an invalid video id.",
  5: "The player could not play this video here.",
  100: "This video was removed or made private.",
  101: "The owner does not allow this video to play outside YouTube.",
  150: "The owner does not allow this video to play outside YouTube.",
  153: "This video cannot be played from this page.",
};

/** Human-readable reason for a YouTube IFrame API `onError` code. */
export function describePlaybackError(code: number): string {
  return ERROR_REASONS[code] ?? "This video could not be played.";
}

/**
 * Where a sitting stands, as the header carrying its controls reads it. The header
 * lives outside the player, so this is the whole of what the player tells it.
 */
export interface SittingPosition {
  /** The entry on screen, null before the first one starts and once the run is over. */
  itemId: string | null;
  /** That entry's 1-based place in the run, null wherever there is no such entry. */
  ordinal: number | null;
  /** How many entries the run holds, which is the run's own frozen count. */
  total: number;
  isDone: boolean;
}

/**
 * Reads the sitting's position off the playback state. A failed item is still the
 * item on screen: the failure banner owns saying it could not be played, while the
 * counter only keeps the sitting's place.
 */
export function readSittingPosition(
  state: PlaybackState,
  items: PlaybackItem[],
): SittingPosition {
  const item = state.status === "idle" || state.status === "done" ? null : items[state.index];
  return {
    itemId: item?.id ?? null,
    ordinal: item ? state.index + 1 : null,
    total: items.length,
    isDone: state.status === "done",
  };
}

/**
 * The counter the header carries in the slot the byline gives up. A run that has
 * not put its first entry on screen yet is still opening on the first one, and a
 * finished run rests on its last.
 */
export function describeSittingPosition(position: SittingPosition): string {
  const place = position.ordinal ?? (position.isDone ? position.total : 1);
  return `${place} of ${position.total}`;
}

export function initialPlaybackState(): PlaybackState {
  return {
    status: "idle",
    index: -1,
    generation: 0,
    armed: false,
    loadedVideoId: null,
    loadKind: null,
    landingTarget: null,
    lastPosition: null,
    stalledMs: 0,
    seenBuffering: false,
    armingWaitedMs: 0,
    failures: [],
  };
}

function currentItem(state: PlaybackState, items: PlaybackItem[]): PlaybackItem | null {
  return items[state.index] ?? null;
}

/**
 * True when a sample the player reported can be taken as the loaded video's own.
 *
 * A sample naming a different video is the entry before this one still on the wire.
 * A sample naming no video is the player refusing to answer: `getVideoData()` throws
 * while the player exchanges modules, and a reading it could not attribute cannot be
 * attributed to this entry either, so nothing is done with it. An event with no id
 * field at all comes from a caller that does not report ids, which contradicts nothing.
 */
function isForLoadedVideo(item: PlaybackItem, videoId: string | null | undefined): boolean {
  if (videoId === undefined) return true;
  if (videoId === null || videoId === "") return false;
  return videoId === item.videoId;
}

/**
 * True when a sample sits where this load asked the player to go. How far past the
 * target the window reaches depends on when the sample was read, which is why the
 * caller supplies it.
 */
function landedOnTarget(target: number, currentTime: number, aheadSec: number): boolean {
  return currentTime >= target - LANDING_BEHIND_SEC && currentTime < target + aheadSec;
}

/**
 * True when a position is where the loaded video runs out. That is the end of a
 * whole-video item, and the only end an item whose range outlives its video will ever
 * reach.
 *
 * The window is bounded on both sides. A player cannot be past the end of the video it
 * is playing, so a position beyond this video's length was read from a different one,
 * which is a reading from before the load landed however current the length beside it
 * looks.
 */
function atVideoEnd(currentTime: number, duration: number | null | undefined): boolean {
  if (typeof duration !== "number" || duration <= 0) return false;
  return (
    currentTime >= duration - VIDEO_END_TOLERANCE_SEC &&
    currentTime <= duration + VIDEO_END_TOLERANCE_SEC
  );
}

/** True when the player has stopped, however it reports having stopped. */
function isStoppedState(playerState: number): boolean {
  return (
    playerState === PLAYER_STATE.ENDED ||
    playerState === PLAYER_STATE.PAUSED ||
    playerState === PLAYER_STATE.CUED
  );
}

/**
 * Arms the current load: from here on the player's events are this item's own. The
 * stall watchdog's baseline is left for the first poll sample after arming to set,
 * since the position a callback carries was read when it fired, not when it arrived.
 */
function arm(state: PlaybackState): PlaybackTransition {
  return {
    state: {
      ...state,
      status: "playing",
      armed: true,
      lastPosition: null,
      stalledMs: 0,
      seenBuffering: false,
    },
    effects: [],
  };
}

function loadIndex(state: PlaybackState, index: number, items: PlaybackItem[]): PlaybackTransition {
  const generation = state.generation + 1;
  const item = items[index];

  if (!item) {
    return {
      state: {
        ...state,
        status: "done",
        index: items.length,
        generation,
        armed: false,
        // The sitting is over and the player is silenced, so nothing is on screen to
        // seek within. A restart that still remembered this video would issue its
        // first item as a move of a player it has already left.
        loadedVideoId: null,
        loadKind: null,
        landingTarget: null,
        lastPosition: null,
        stalledMs: 0,
        seenBuffering: false,
        armingWaitedMs: 0,
      },
      // Nothing follows the last item, so the player has to be silenced rather than
      // left running under the finished sitting.
      effects: [{ kind: "pause" }, { kind: "finish" }],
    };
  }

  const startSec = item.startSec ?? 0;
  const isSeek = state.loadedVideoId === item.videoId;

  return {
    state: {
      ...state,
      status: "loading",
      index,
      generation,
      armed: false,
      loadedVideoId: item.videoId,
      loadKind: isSeek ? "seek" : "load",
      landingTarget: startSec,
      lastPosition: null,
      stalledMs: 0,
      seenBuffering: false,
      armingWaitedMs: 0,
    },
    effects: [
      isSeek
        ? { kind: "seek", index, item, generation, toSec: startSec }
        : { kind: "load", index, item, generation },
      // Nothing else can move an item that never arms, so every load is paired with
      // the watchdog that gives up on it.
      { kind: "scheduleArmingTimeout", generation, delayMs: ARMING_TIMEOUT_MS },
    ],
  };
}

function recordFailure(state: PlaybackState, item: PlaybackItem, code: number): PlaybackTransition {
  const failure: PlaybackFailure = {
    itemId: item.id,
    index: state.index,
    code,
    reason: describePlaybackError(code),
  };
  return {
    state: {
      ...state,
      status: "failed",
      armed: false,
      loadKind: null,
      landingTarget: null,
      // What the player is showing is no longer known, so the next item of this same
      // video is reloaded rather than seeked within a player that may be dead.
      loadedVideoId: null,
      failures: [...state.failures, failure],
    },
    effects: [
      {
        kind: "scheduleFailureAdvance",
        generation: state.generation,
        delayMs: FAILURE_ADVANCE_DELAY_MS,
      },
    ],
  };
}

function advance(state: PlaybackState, items: PlaybackItem[]): PlaybackTransition {
  return loadIndex(state, state.index + 1, items);
}

function unchanged(state: PlaybackState): PlaybackTransition {
  return { state, effects: [] };
}

/**
 * Decides whether a sample proves this load is what the player is showing. Every load
 * asked the player for a position, and a sample that is not on it was read from
 * playback this load did not ask for, which is the entry before it running on.
 */
function proves(state: PlaybackState, currentTime: number, aheadSec: number): boolean {
  return state.landingTarget !== null && landedOnTarget(state.landingTarget, currentTime, aheadSec);
}

/**
 * True when a reading cannot be this item's end because it sits behind where the item
 * was sent: the item has not played that stretch, so the reading was taken before it
 * began. That rejects only readings from before this item started, so no end an item
 * can actually reach is ever refused.
 */
function behindItsOwnStart(item: PlaybackItem, currentTime: number): boolean {
  return currentTime < (item.startSec ?? 0) - LANDING_BEHIND_SEC;
}

/**
 * The end an armed item reaches by running out of video rather than by crossing its
 * own boundary, as the poll finds it. A poll sample is read in one piece, so the
 * length it carries describes the video the position was read from: a player at rest
 * anywhere but that video's end has not run out of it, whether it says so with
 * `ENDED`, by parking, or by the viewer pausing there.
 */
function pollFoundVideoEnd(
  item: PlaybackItem,
  event: { state: number; currentTime: number; duration?: number | null },
): boolean {
  if (behindItsOwnStart(item, event.currentTime)) return false;
  if (typeof event.duration === "number" && event.duration > 0) {
    return isStoppedState(event.state) && atVideoEnd(event.currentTime, event.duration);
  }
  // With no length to check against, only the player's own word for it will do.
  return event.state === PLAYER_STATE.ENDED;
}

/**
 * The same end as reported by a state change rather than by the poll, which is the
 * backstop for a video that runs out between two samples.
 *
 * A callback is not one reading: its position was taken when it fired and everything
 * beside it when it arrived, so it can only be trusted where the two agree. That rules
 * out a range of the video already on screen, whose id is shared with the range before
 * it, and it rules out any callback whose position the loaded video's own length
 * cannot account for, which is every stale terminal event bar one fired at the same
 * offset in a video of exactly the same length.
 */
function eventEndedVideo(
  state: PlaybackState,
  item: PlaybackItem,
  event: { state: number; currentTime: number; duration?: number | null },
): boolean {
  if (state.loadKind !== "load") return false;
  if (event.state !== PLAYER_STATE.ENDED) return false;
  if (behindItsOwnStart(item, event.currentTime)) return false;
  if (typeof event.duration === "number" && event.duration > 0) {
    return atVideoEnd(event.currentTime, event.duration);
  }
  return true;
}

/** How much of the gap before a poll sample that sample is allowed to attest to. */
function creditedMs(sinceLastMs: number | undefined): number {
  if (typeof sinceLastMs !== "number" || sinceLastMs <= 0) return BOUNDARY_POLL_INTERVAL_MS;
  return Math.min(sinceLastMs, MAX_SAMPLE_CREDIT_MS);
}

/**
 * Folds a poll sample into the stall watchdog. A viewer's pause holds the counter
 * where it is: a paused sitting is waiting for the viewer, and marching past it would
 * skip the very item they stopped to look at.
 *
 * A run of frozen samples that has included the player saying it is buffering is
 * measured against the rebuffer budget rather than the stall one, right through the
 * sample where the player claims to be playing again but its clock has not caught up.
 */
function trackProgress(
  state: PlaybackState,
  item: PlaybackItem,
  event: { state: number; currentTime: number; sinceLastMs?: number },
): PlaybackTransition {
  if (event.state === PLAYER_STATE.PAUSED) return unchanged(state);

  // Any movement of the player's clock counts, in either direction: a stall is a
  // frozen clock, and a position that jumps backwards is a player that just moved.
  const progressed =
    state.lastPosition === null ||
    Math.abs(event.currentTime - state.lastPosition) > PROGRESS_EPSILON_SEC;
  if (progressed) {
    return {
      state: {
        ...state,
        lastPosition: event.currentTime,
        stalledMs: 0,
        seenBuffering: false,
      },
      effects: [],
    };
  }

  const budgetMs = state.seenBuffering ? REBUFFER_TIMEOUT_MS : STALL_TIMEOUT_MS;
  const stalledMs = state.stalledMs + creditedMs(event.sinceLastMs);
  if (stalledMs < budgetMs) {
    return { state: { ...state, stalledMs }, effects: [] };
  }
  return recordFailure(state, item, STALLED_ERROR_CODE);
}

/**
 * Decides what a single player event means for the sitting. Returns the next state
 * plus the imperative effects the host component should perform in order.
 */
export function reducePlayback(
  state: PlaybackState,
  event: PlaybackEvent,
  items: PlaybackItem[],
): PlaybackTransition {
  switch (event.kind) {
    case "start": {
      if (state.status !== "idle" && state.status !== "done") return unchanged(state);
      const fresh: PlaybackState = { ...state, failures: [] };
      const started = loadIndex(fresh, 0, items);
      if (started.state.status !== "loading") return started;
      return { state: started.state, effects: [...started.effects, { kind: "play" }] };
    }

    case "stop": {
      return {
        state: {
          ...state,
          status: "idle",
          index: -1,
          generation: state.generation + 1,
          armed: false,
          loadedVideoId: null,
          loadKind: null,
          landingTarget: null,
          lastPosition: null,
          stalledMs: 0,
          seenBuffering: false,
          armingWaitedMs: 0,
        },
        effects: [{ kind: "pause" }, { kind: "finish" }],
      };
    }

    case "skip": {
      if (state.status !== "loading" && state.status !== "playing" && state.status !== "failed") {
        return unchanged(state);
      }
      return advance(state, items);
    }

    case "prev": {
      if (state.status === "idle") return unchanged(state);
      // A finished sitting sits one past its last entry, and the first entry has
      // nothing before it, so back from the top is a restart of the top.
      const from = Math.min(state.index, items.length);
      return loadIndex(state, Math.max(from - 1, 0), items);
    }

    case "failureAdvance": {
      if (state.status !== "failed" || event.generation !== state.generation) {
        return unchanged(state);
      }
      return advance(state, items);
    }

    case "playerError": {
      if (state.status !== "loading" && state.status !== "playing") return unchanged(state);
      const item = currentItem(state, items);
      if (!item || !isForLoadedVideo(item, event.videoId)) return unchanged(state);
      return recordFailure(state, item, event.code);
    }

    case "armingTimeout": {
      // "loading" is exactly the window before the item armed; every other status
      // either armed, moved on or already recorded a failure of its own.
      if (state.status !== "loading" || event.generation !== state.generation) {
        return unchanged(state);
      }
      const item = currentItem(state, items);
      if (!item) return unchanged(state);

      // An item the player is buffering has not failed to start, it has not finished
      // starting, so it is given the same budget a rebuffer gets mid-item before the
      // sitting gives up on it.
      const armingWaitedMs = state.armingWaitedMs + ARMING_TIMEOUT_MS;
      if (state.seenBuffering && armingWaitedMs < REBUFFER_TIMEOUT_MS) {
        return {
          state: { ...state, armingWaitedMs },
          effects: [
            {
              kind: "scheduleArmingTimeout",
              generation: state.generation,
              delayMs: ARMING_TIMEOUT_MS,
            },
          ],
        };
      }
      return recordFailure(state, item, STALLED_ERROR_CODE);
    }

    case "playerState": {
      if (state.status !== "loading" && state.status !== "playing") return unchanged(state);
      const item = currentItem(state, items);
      if (!item || !isForLoadedVideo(item, event.videoId)) return unchanged(state);

      if (!state.armed) {
        // A state change is the only thing that arms a load, and only when it is the
        // player reporting that this load is playing where the load asked it to.
        return event.state === PLAYER_STATE.PLAYING &&
          proves(state, event.currentTime, EVENT_LANDING_AHEAD_SEC)
          ? arm(state)
          : unchanged(state);
      }

      return eventEndedVideo(state, item, event) ? advance(state, items) : unchanged(state);
    }

    case "tick": {
      if (state.status !== "loading" && state.status !== "playing") return unchanged(state);
      const item = currentItem(state, items);
      if (!item || !isForLoadedVideo(item, event.videoId)) return unchanged(state);

      // Every sample the poll can attribute reports whether the player is still working
      // on this load, which is what both watchdogs read to tell slow from dead.
      const seen: PlaybackState =
        event.state === PLAYER_STATE.BUFFERING ? { ...state, seenBuffering: true } : state;

      if (!seen.armed) {
        // The poll arms one load and one only: a seek within the video already on
        // screen, which can leave the player in `PLAYING` throughout and so produce no
        // state change to arm from. The sample still has to land where the seek asked.
        return seen.loadKind === "seek" &&
          event.state === PLAYER_STATE.PLAYING &&
          proves(seen, event.currentTime, POLL_LANDING_AHEAD_SEC)
          ? arm(seen)
          : unchanged(seen);
      }

      if (pollFoundVideoEnd(item, event)) return advance(seen, items);

      // The primary end-boundary detector: this item is armed, so the position the
      // poll reads is this item's own.
      if (
        event.state === PLAYER_STATE.PLAYING &&
        item.endSec !== null &&
        event.currentTime >= item.endSec
      ) {
        return advance(seen, items);
      }

      return trackProgress(seen, item, event);
    }
  }
}
