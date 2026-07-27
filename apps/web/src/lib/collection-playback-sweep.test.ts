import { describe, expect, it } from "vitest";
import {
  BOUNDARY_POLL_INTERVAL_MS,
  PLAYER_STATE,
  STALL_TIMEOUT_MS,
  THROTTLED_POLL_INTERVAL_MS,
  initialPlaybackState,
  reducePlayback,
  type PlaybackEvent,
  type PlaybackItem,
  type PlaybackState,
} from "./collection-playback";

/**
 * A discrete-time simulation of the player the reducer drives, swept across the
 * timing hazards the module docblock names.
 *
 * Hand-written example tests pin the transitions someone already thought of, which is
 * exactly how a silent skip survives a fix: the skips live in timings nobody wrote
 * down. This file instead plays every collection shape through a modelled player at
 * every combination of load latency, seek latency, callback delivery, whether a seek
 * within the loaded video produces a state change at all, spurious `ENDED t=0`, a
 * redundant `PLAYING` near an entry's boundary, whether the player can name the video
 * it is swapping to, poll cadence, a viewer's interruption and how a player reports
 * running out of video, and asserts the invariants a sitting must hold rather than the
 * transitions it takes.
 *
 * Ground truth comes from the simulated player, not from the reducer's own
 * bookkeeping. The invariant that matters is that each entry actually renders its own
 * range: an entry that appears for a fraction of a second before being dropped has
 * been skipped as far as the viewer is concerned, however cleanly the reducer walked
 * its indices.
 */

/** Simulation granularity. Every swept duration below is a multiple of it. */
const STEP_MS = 20;

/**
 * Wall-clock ceiling on one scenario. Comfortably past the longest healthy run
 * (the stall watchdog plus the failure pause plus every entry), so a run that hits
 * it has stalled.
 */
const MAX_SIM_MS = 180_000;

/**
 * Per-shape timeout, in place of vitest's five-second default. One shape drives every
 * scenario in the grid, each of which steps a simulated player up to
 * `MAX_SIM_MS / STEP_MS` times, so the slowest shapes run for the better part of ten
 * seconds on a warm machine and longer on a loaded one. Sized so a shape that has only
 * grown slower is still reported as the failure it found rather than as a timeout.
 */
const SWEEP_TIMEOUT_MS = 120_000;

/** Fraction of its own playable span an entry has to render to count as played. */
const MIN_PLAYED_FRACTION = 0.8;

/** Spans shorter than this are judged by whether the entry was ever on screen. */
const MEASURABLE_SPAN_MS = 1000;

/** How long after an entry lands the modelled viewer interrupts it. */
const INTERRUPTION_AFTER_MS = 400;
const VIEWER_PAUSE_MS = 2000;

/** A buffering blip the player recovers from well inside any watchdog. */
const BUFFERING_BLIP_MS = 1600;

/**
 * How long the modelled rebuffer lasts. Past the stall watchdog, because a rebuffer
 * that resolves inside it can never be told apart from healthy playback, and the
 * question the sweep has to answer is what the watchdog does to a legitimate entry
 * whose player is genuinely working the whole time.
 */
const BUFFERING_MS = 20_000;

/** How long a stalling entry plays before its player freezes for good. */
const STALL_AFTER_MS = 1000;

/**
 * How close to the boundary it will stop at an entry gets before the player emits a
 * redundant `PLAYING`. The IFrame API emits one after any buffering blip, ad break or
 * quality switch, and one emitted here is delivered around the moment the sitting
 * moves on, so it carries the outgoing entry's clock and the incoming entry's id.
 */
const REDUNDANT_PLAYING_LEAD_SEC = 0.3;

interface Shape {
  name: string;
  items: PlaybackItem[];
  /** Real length of each video the shape touches, as `getDuration()` reports it. */
  durations: Record<string, number>;
  /**
   * Entries the player genuinely cannot carry, so a recorded failure is the right
   * outcome for them. Every other entry has to actually play, and a failure recorded
   * against one is itself a violation.
   */
  mayFail?: number[];
  /**
   * Entry whose player starts, plays for `STALL_AFTER_MS`, and then freezes for good.
   * It has to start first: an entry that never starts is the arming watchdog's, and a
   * stall that only ever happens before arming leaves the stall watchdog unexercised.
   */
  stallsForever?: number;
}

type Interruption = "none" | "pause" | "blip" | "rebuffer";

/**
 * How the player's callbacks reach the reducer.
 *
 * `reordered` gives consecutive callbacks different delays, which is the only way
 * delivery order can differ from firing order. A single delay makes the queue strictly
 * order-preserving, so nothing fired before an entry armed can ever arrive after it.
 */
type Delivery = "prompt" | "delayed" | "reordered";

/** Delay applied to alternate callbacks, in firing order. */
const DELIVERY_DELAYS_MS: Record<Delivery, readonly [number, number]> = {
  prompt: [0, 0],
  delayed: [240, 240],
  reordered: [240, 40],
};

/**
 * What `getVideoData()` says while the player exchanges modules, which is the window
 * the outgoing entry's clock is still running in.
 *
 * `blank` is the call throwing, which the component reports as null. `ahead` is the
 * player naming the incoming video before a frame of it exists, which is the same
 * incoherence the spike logged on callbacks: the id is current and the clock is not.
 */
type SwapIdentity = "stale" | "blank" | "ahead";

const SWAP_IDENTITIES: SwapIdentity[] = ["stale", "blank", "ahead"];

/** The cadence the component's poll actually runs at, phase included. */
interface PollCadence {
  intervalMs: number;
  phaseMs: number;
}

const POLL_CADENCES: PollCadence[] = [
  { intervalMs: BOUNDARY_POLL_INTERVAL_MS, phaseMs: 0 },
  { intervalMs: BOUNDARY_POLL_INTERVAL_MS, phaseMs: 100 },
  // What a backgrounded tab clamps the component's interval to.
  { intervalMs: THROTTLED_POLL_INTERVAL_MS, phaseMs: 0 },
];

interface Hazards {
  /** How long `loadVideoById` takes to land, during which the outgoing entry plays on. */
  loadLatencyMs: number;
  /** How long a `seekTo` takes to be reflected in what the player reports. */
  seekLatencyMs: number;
  /** How `onStateChange` callbacks reach the reducer once they have fired. */
  delivery: Delivery;
  /**
   * Whether a seek inside the video already on screen produces a `PLAYING` callback.
   * A player that never leaves `PLAYING` has no state change to report, which is the
   * case that leaves an entry with no callback of its own to arm from.
   */
  seekFiresStateChange: boolean;
  /** Whether a fresh load emits the spurious `ENDED t=0` the spike recorded. */
  spuriousEndedOnLoad: boolean;
  /** Whether the player emits a redundant `PLAYING` shortly before an entry's boundary. */
  redundantPlayingNearBoundary: boolean;
  /** What the player names while a load is in flight. */
  idDuringSwap: SwapIdentity;
  /** The cadence the poll runs at, so boundaries land at every phase of a live and a
   * throttled interval. */
  poll: PollCadence;
  /** What the modelled viewer does to the second entry of the sitting. */
  interruption: Interruption;
  /** What the player reports once a video runs out. */
  naturalEndState: number;
}

const LOAD_LATENCIES_MS = [0, 120, 260, 560];
const SEEK_LATENCIES_MS = [0, 200, 400];
const DELIVERIES: Delivery[] = ["prompt", "delayed", "reordered"];
const INTERRUPTIONS: Interruption[] = ["none", "pause", "blip", "rebuffer"];
const NATURAL_END_STATES = [PLAYER_STATE.ENDED, PLAYER_STATE.PAUSED, PLAYER_STATE.CUED];

function hazardGrid(): Hazards[] {
  const grid: Hazards[] = [];
  for (const loadLatencyMs of LOAD_LATENCIES_MS) {
    for (const seekLatencyMs of SEEK_LATENCIES_MS) {
      for (const delivery of DELIVERIES) {
        for (const seekFiresStateChange of [false, true]) {
          for (const spuriousEndedOnLoad of [false, true]) {
            for (const redundantPlayingNearBoundary of [false, true]) {
              for (const idDuringSwap of SWAP_IDENTITIES) {
                for (const poll of POLL_CADENCES) {
                  for (const interruption of INTERRUPTIONS) {
                    for (const naturalEndState of NATURAL_END_STATES) {
                      grid.push({
                        loadLatencyMs,
                        seekLatencyMs,
                        delivery,
                        seekFiresStateChange,
                        spuriousEndedOnLoad,
                        redundantPlayingNearBoundary,
                        idDuringSwap,
                        poll,
                        interruption,
                        naturalEndState,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return grid;
}

interface SimResult {
  state: PlaybackState;
  /** Item index of every load and seek effect, in the order the reducer asked for them. */
  loadOrder: number[];
  /** Milliseconds of its own video the modelled player rendered for each entry. */
  playedMs: number[];
  /** Milliseconds each entry spent as the thing on screen. */
  liveMs: number[];
  /**
   * Milliseconds each entry went on playing past its own `endSec`. Handing the player
   * no `endSeconds` buys the sitting out of a whole class of stale terminal events;
   * this is what that costs, and a throttled poll is where the bill comes due.
   */
  overshootMs: number[];
  finished: boolean;
}

/** A player callback that has fired and is on its way to the reducer. */
interface QueuedCallback {
  at: number;
  state: number;
  /**
   * The position the player was at when the callback fired. The component reads
   * `getCurrentTime()` inside the callback, but the spike's log shows the outgoing
   * entry's time arriving alongside the incoming entry's id, so the time is pinned at
   * fire and the id is sampled at delivery.
   */
  currentTime: number;
}

/** A load or seek the reducer asked for that has not taken effect yet. */
interface PendingChange {
  at: number;
  index: number;
  kind: "load" | "seek";
  toSec: number;
}

/** Real length of a video the shape touches, refusing a shape that never declared one. */
function durationOf(shape: Shape, videoId: string): number {
  const duration = shape.durations[videoId];
  if (duration === undefined) {
    throw new Error(`shape "${shape.name}" declares no duration for video ${videoId}`);
  }
  return duration;
}

function simulate(shape: Shape, hazards: Hazards): SimResult {
  const { items } = shape;

  let state = initialPlaybackState();
  const loadOrder: number[] = [];
  const playedMs = items.map(() => 0);
  const liveMs = items.map(() => 0);
  const overshootMs = items.map(() => 0);

  const interruptedIndex = Math.min(1, items.length - 1);
  const deliveryDelays = DELIVERY_DELAYS_MS[hazards.delivery];

  let now = 0;
  let pending: PendingChange | null = null;
  /** Entry whose load has actually landed; -1 before the first one does. */
  let liveIndex = -1;
  let videoId: string | null = null;
  /** Length of the video on screen, read once at each landing rather than per step. */
  let liveDuration = 0;
  let position = 0;
  let playerState: number = PLAYER_STATE.UNSTARTED;
  let queued: QueuedCallback[] = [];
  let callbacksFired = 0;
  let redundantPlayingFired = false;
  let armingTimer: { at: number; generation: number } | null = null;
  let failureTimer: { at: number; generation: number } | null = null;
  let interruptionAt: number | null = null;
  let resumeAt: number | null = null;
  let freezeAt: number | null = null;

  function dispatch(event: PlaybackEvent): void {
    const transition = reducePlayback(state, event, items);
    state = transition.state;
    if (state.armed) armingTimer = null;
    for (const effect of transition.effects) {
      switch (effect.kind) {
        case "load":
          loadOrder.push(effect.index);
          pending = {
            at: now + hazards.loadLatencyMs,
            index: effect.index,
            kind: "load",
            toSec: effect.item.startSec ?? 0,
          };
          break;
        case "seek":
          loadOrder.push(effect.index);
          pending = {
            at: now + hazards.seekLatencyMs,
            index: effect.index,
            kind: "seek",
            toSec: effect.toSec,
          };
          break;
        case "play":
          break;
        case "scheduleFailureAdvance":
          failureTimer = { at: now + effect.delayMs, generation: effect.generation };
          break;
        case "scheduleArmingTimeout":
          armingTimer = { at: now + effect.delayMs, generation: effect.generation };
          break;
        case "finish":
          armingTimer = null;
          failureTimer = null;
          break;
      }
    }
  }

  function queueCallback(state_: number, at: number): void {
    const delay = deliveryDelays[callbacksFired % deliveryDelays.length];
    callbacksFired += 1;
    queued.push({ at: now + delay, state: state_, currentTime: at });
  }

  /**
   * The video id the component would report right now, which only agrees with the
   * frames on screen outside a swap. Inside one it is whatever `idDuringSwap` says.
   */
  function reportedVideoId(): string | null {
    if (pending === null || pending.kind !== "load") return videoId;
    if (hazards.idDuringSwap === "blank") return null;
    if (hazards.idDuringSwap === "ahead") return items[pending.index].videoId;
    return videoId;
  }

  /** The length the player would report right now, from the same reading as the id. */
  function reportedDuration(reported: string | null): number | null {
    return reported === null ? null : durationOf(shape, reported);
  }

  function scheduleInterruption(index: number): void {
    if (hazards.interruption === "none") return;
    if (index !== interruptedIndex || index === shape.stallsForever) return;
    interruptionAt = now + INTERRUPTION_AFTER_MS;
  }

  function land(change: PendingChange): void {
    const item = items[change.index];
    const duration = durationOf(shape, item.videoId);
    const wasPlaying = playerState === PLAYER_STATE.PLAYING;

    liveIndex = change.index;
    videoId = item.videoId;
    liveDuration = duration;
    redundantPlayingFired = false;
    freezeAt = shape.stallsForever === change.index ? now + STALL_AFTER_MS : null;

    if (change.toSec >= duration) {
      // A range saved before the video was re-uploaded shorter: the seek lands past
      // the end and the player parks there without ever playing the range.
      position = duration;
      playerState = hazards.naturalEndState;
      queueCallback(playerState, position);
      return;
    }

    position = change.toSec;
    playerState = PLAYER_STATE.PLAYING;
    if (change.kind === "load") {
      if (hazards.spuriousEndedOnLoad) queueCallback(PLAYER_STATE.ENDED, 0);
      queueCallback(PLAYER_STATE.PLAYING, position);
    } else if (hazards.seekFiresStateChange || !wasPlaying) {
      // A player that was stopped genuinely transitions into PLAYING; one that never
      // left PLAYING has no state change to report unless this player happens to.
      queueCallback(PLAYER_STATE.PLAYING, position);
    }
    scheduleInterruption(change.index);
  }

  function runFreeze(): void {
    if (freezeAt === null || now < freezeAt) return;
    freezeAt = null;
    interruptionAt = null;
    resumeAt = null;
    playerState = PLAYER_STATE.BUFFERING;
    queueCallback(playerState, position);
  }

  function interruptionLengthMs(): number {
    switch (hazards.interruption) {
      case "pause":
        return VIEWER_PAUSE_MS;
      case "blip":
        return BUFFERING_BLIP_MS;
      default:
        return BUFFERING_MS;
    }
  }

  function runInterruption(): void {
    if (interruptionAt !== null && now >= interruptionAt) {
      interruptionAt = null;
      if (playerState === PLAYER_STATE.PLAYING) {
        playerState =
          hazards.interruption === "pause" ? PLAYER_STATE.PAUSED : PLAYER_STATE.BUFFERING;
        queueCallback(playerState, position);
        resumeAt = now + interruptionLengthMs();
      }
      return;
    }
    if (resumeAt !== null && now >= resumeAt) {
      resumeAt = null;
      playerState = PLAYER_STATE.PLAYING;
      queueCallback(playerState, position);
    }
  }

  function advancePlayback(): void {
    if (playerState !== PLAYER_STATE.PLAYING || liveIndex < 0 || videoId === null) return;

    const item = items[liveIndex];
    const duration = liveDuration;
    position = Math.min(position + STEP_MS / 1000, duration);
    playedMs[liveIndex] += STEP_MS;
    if (item.endSec !== null && position > item.endSec) overshootMs[liveIndex] += STEP_MS;

    if (hazards.redundantPlayingNearBoundary && !redundantPlayingFired) {
      const boundary = Math.min(item.endSec ?? duration, duration);
      if (position >= boundary - REDUNDANT_PLAYING_LEAD_SEC) {
        redundantPlayingFired = true;
        queueCallback(PLAYER_STATE.PLAYING, position);
      }
    }

    if (position >= duration) {
      playerState = hazards.naturalEndState;
      queueCallback(playerState, position);
    }
  }

  function deliverCallbacks(): void {
    if (queued.length === 0) return;
    // Sorting by arrival is what lets a callback fired later overtake one fired first;
    // ties keep firing order, which `Array.prototype.sort` is required to preserve.
    const due = queued.filter((callback) => callback.at <= now).sort((a, b) => a.at - b.at);
    queued = queued.filter((callback) => callback.at > now);
    for (const callback of due) {
      const reported = reportedVideoId();
      dispatch({
        kind: "playerState",
        state: callback.state,
        currentTime: callback.currentTime,
        videoId: reported,
        duration: reportedDuration(reported),
      });
    }
  }

  function fireTimers(): void {
    if (armingTimer && now >= armingTimer.at) {
      const { generation } = armingTimer;
      armingTimer = null;
      dispatch({ kind: "armingTimeout", generation });
    }
    if (failureTimer && now >= failureTimer.at) {
      const { generation } = failureTimer;
      failureTimer = null;
      dispatch({ kind: "failureAdvance", generation });
    }
  }

  function poll(): void {
    if (now < hazards.poll.phaseMs) return;
    if ((now - hazards.poll.phaseMs) % hazards.poll.intervalMs !== 0) return;
    if (state.status !== "loading" && state.status !== "playing") return;
    const reported = reportedVideoId();
    dispatch({
      kind: "tick",
      state: playerState,
      currentTime: position,
      videoId: reported,
      duration: reportedDuration(reported),
      sinceLastMs: hazards.poll.intervalMs,
    });
  }

  function landDueChange(): void {
    if (!pending || now < pending.at) return;
    const change = pending;
    pending = null;
    land(change);
  }

  dispatch({ kind: "start" });

  while (now < MAX_SIM_MS && state.status !== "done") {
    now += STEP_MS;
    landDueChange();
    runFreeze();
    runInterruption();
    advancePlayback();
    if (liveIndex >= 0) liveMs[liveIndex] += STEP_MS;
    deliverCallbacks();
    fireTimers();
    poll();
  }

  return { state, loadOrder, playedMs, liveMs, overshootMs, finished: state.status === "done" };
}

/** How much of its own video an entry can possibly render, in milliseconds. */
function playableSpanMs(shape: Shape, index: number): number {
  const item = shape.items[index];
  const duration = durationOf(shape, item.videoId);
  const start = Math.min(item.startSec ?? 0, duration);
  const end = Math.min(item.endSec ?? duration, duration);
  return Math.max(0, end - start) * 1000;
}

/**
 * How far past its own end an entry may run before the overshoot is a defect rather
 * than the price of leaving the boundary to the poll. The poll can miss the crossing
 * by a whole interval; on the interval that arms an entry it does nothing else, so a
 * range short enough to end before the next sample costs a second interval; the load
 * that replaces it takes its own latency to land; and an entry armed from a callback
 * waits out that callback's delivery first.
 */
function overshootBudgetMs(hazards: Hazards): number {
  return (
    2 * hazards.poll.intervalMs +
    Math.max(...DELIVERY_DELAYS_MS[hazards.delivery]) +
    Math.max(hazards.loadLatencyMs, hazards.seekLatencyMs) +
    2 * STEP_MS
  );
}

/** Every way a run can betray the sitting, phrased so a failure names the entry. */
function violations(shape: Shape, result: SimResult, hazards: Hazards): string[] {
  const problems: string[] = [];
  const mayFail = new Set(shape.mayFail ?? []);
  const overshootBudget = overshootBudgetMs(hazards);

  if (!result.finished) problems.push("the run never finished");

  const inOrder = shape.items.map((_, index) => index);
  if (result.loadOrder.join(",") !== inOrder.join(",")) {
    problems.push(`entries were loaded as [${result.loadOrder.join(",")}], not in order`);
  }

  for (const [index, item] of shape.items.entries()) {
    const failed = result.state.failures.some((failure) => failure.index === index);
    if (failed && !mayFail.has(index)) {
      problems.push(`entry ${index} (${item.id}) recorded a failure it should not have`);
    }

    const spanMs = playableSpanMs(shape, index);
    const playedEnough =
      spanMs >= MEASURABLE_SPAN_MS
        ? result.playedMs[index] >= spanMs * MIN_PLAYED_FRACTION
        : result.liveMs[index] > 0;

    if (!playedEnough && !(failed && mayFail.has(index))) {
      problems.push(
        `entry ${index} (${item.id}) rendered ${result.playedMs[index]}ms of its ${spanMs}ms range` +
          ` (on screen for ${result.liveMs[index]}ms) and no failure was recorded`,
      );
    }

    if (result.overshootMs[index] > overshootBudget) {
      problems.push(
        `entry ${index} (${item.id}) played ${result.overshootMs[index]}ms past its own end,` +
          ` past the ${overshootBudget}ms the poll's cadence can account for`,
      );
    }
  }

  return problems;
}

function describeHazards(hazards: Hazards): string {
  return [
    `load+${hazards.loadLatencyMs}ms`,
    `seek+${hazards.seekLatencyMs}ms`,
    `delivery=${hazards.delivery}`,
    `seekFiresStateChange=${hazards.seekFiresStateChange}`,
    `spuriousEnded=${hazards.spuriousEndedOnLoad}`,
    `redundantPlaying=${hazards.redundantPlayingNearBoundary}`,
    `idDuringSwap=${hazards.idDuringSwap}`,
    `poll=${hazards.poll.intervalMs}ms@${hazards.poll.phaseMs}ms`,
    `interruption=${hazards.interruption}`,
    `naturalEndState=${hazards.naturalEndState}`,
  ].join(" ");
}

const LONG = "dQw4w9WgXcQ";
const SHORT = "aqz-KE-bpKQ";
const OTHER = "M7lc1UVf-VE";

const SHAPES: Shape[] = [
  {
    name: "contiguous ranges of one video",
    items: [
      { id: "a", videoId: LONG, startSec: 10, endSec: 20 },
      { id: "b", videoId: LONG, startSec: 20, endSec: 30 },
      { id: "c", videoId: LONG, startSec: 30, endSec: 40 },
    ],
    durations: { [LONG]: 120 },
  },
  {
    name: "the same whole video twice",
    items: [
      { id: "w1", videoId: SHORT, startSec: null, endSec: null },
      { id: "w2", videoId: SHORT, startSec: null, endSec: null },
      { id: "w3", videoId: OTHER, startSec: null, endSec: null },
    ],
    durations: { [SHORT]: 22, [OTHER]: 15 },
  },
  {
    name: "a range whose endSec outlives the video",
    items: [
      { id: "over", videoId: SHORT, startSec: 10, endSec: 300 },
      { id: "after", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [SHORT]: 22, [OTHER]: 15 },
  },
  {
    name: "a zero-length range",
    items: [
      { id: "point", videoId: LONG, startSec: 30, endSec: 30 },
      { id: "after", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [LONG]: 120, [OTHER]: 15 },
  },
  {
    name: "overlapping ranges of one video",
    items: [
      { id: "o1", videoId: LONG, startSec: 10, endSec: 30 },
      { id: "o2", videoId: LONG, startSec: 20, endSec: 40 },
      { id: "o3", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [LONG]: 120, [OTHER]: 15 },
  },
  {
    name: "a later range that sits behind the one before it",
    items: [
      { id: "b1", videoId: LONG, startSec: 60, endSec: 70 },
      { id: "b2", videoId: LONG, startSec: 10, endSec: 20 },
      { id: "b3", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [LONG]: 120, [OTHER]: 15 },
  },
  {
    name: "ranges of separate videos",
    items: [
      { id: "d1", videoId: LONG, startSec: 30, endSec: 40 },
      { id: "d2", videoId: SHORT, startSec: 5, endSec: 15 },
      { id: "d3", videoId: OTHER, startSec: null, endSec: null },
    ],
    durations: { [LONG]: 120, [SHORT]: 22, [OTHER]: 15 },
  },
  {
    name: "a range the video is too short to reach",
    items: [
      { id: "gone", videoId: SHORT, startSec: 4000, endSec: 4100 },
      { id: "next", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [SHORT]: 22, [OTHER]: 15 },
    mayFail: [0],
  },
  {
    name: "an entry whose player freezes after it starts",
    items: [
      { id: "s1", videoId: LONG, startSec: 10, endSec: 20 },
      { id: "s2", videoId: SHORT, startSec: 2, endSec: 12 },
      { id: "s3", videoId: OTHER, startSec: 0, endSec: 5 },
    ],
    durations: { [LONG]: 120, [SHORT]: 22, [OTHER]: 15 },
    stallsForever: 1,
    mayFail: [1],
  },
];

describe("collection playback swept across the player's timing hazards", () => {
  const grid = hazardGrid();

  it("keeps the simulation faithful to the poll it models", () => {
    // A poll interval or phase that is not a whole number of steps would sample at
    // times the simulation never reaches, quietly narrowing the sweep.
    expect(BOUNDARY_POLL_INTERVAL_MS % STEP_MS).toBe(0);
    for (const cadence of POLL_CADENCES) {
      expect(cadence.intervalMs % STEP_MS).toBe(0);
      expect(cadence.phaseMs % STEP_MS).toBe(0);
    }
    for (const latency of LOAD_LATENCIES_MS) expect(latency % STEP_MS).toBe(0);
    for (const latency of SEEK_LATENCIES_MS) expect(latency % STEP_MS).toBe(0);
    for (const delays of Object.values(DELIVERY_DELAYS_MS)) {
      for (const delay of delays) expect(delay % STEP_MS).toBe(0);
    }
    expect(INTERRUPTION_AFTER_MS % STEP_MS).toBe(0);
    expect(VIEWER_PAUSE_MS % STEP_MS).toBe(0);
    expect(BUFFERING_BLIP_MS % STEP_MS).toBe(0);
    expect(BUFFERING_MS % STEP_MS).toBe(0);
    expect(STALL_AFTER_MS % STEP_MS).toBe(0);

    // A shape that names a video it declares no length for would otherwise feed
    // undefined into every comparison and quietly pass as NaN.
    for (const shape of SHAPES) {
      for (const item of shape.items) expect(durationOf(shape, item.videoId)).toBeGreaterThan(0);
    }
    expect(() => durationOf(SHAPES[0], "not-a-video-in-this-shape")).toThrow();
  });

  it("sweeps a hazard grid the reducer cannot sit outside of", () => {
    expect(grid).toHaveLength(31_104);
    expect(SHAPES.length * grid.length).toBe(279_936);

    // Each of these was a blind spot the reducer was quietly relying on, so a grid
    // that ever stops covering one is a grid that has stopped being a check.
    expect(DELIVERIES).toContain("reordered");
    expect(grid.some((hazards) => hazards.redundantPlayingNearBoundary)).toBe(true);
    for (const identity of SWAP_IDENTITIES) {
      expect(grid.some((hazards) => hazards.idDuringSwap === identity)).toBe(true);
    }
    expect(grid.some((hazards) => hazards.poll.intervalMs > BOUNDARY_POLL_INTERVAL_MS)).toBe(true);
    expect(BUFFERING_MS).toBeGreaterThan(STALL_TIMEOUT_MS);
  });

  for (const shape of SHAPES) {
    it(`holds every invariant for ${shape.name}`, () => {
      const problems: string[] = [];
      let brokenScenarios = 0;
      for (const hazards of grid) {
        const found = violations(shape, simulate(shape, hazards), hazards);
        if (found.length > 0) brokenScenarios += 1;
        for (const problem of found) problems.push(`${describeHazards(hazards)}: ${problem}`);
      }
      const report = [
        `${brokenScenarios} of ${grid.length} scenarios broke an invariant` +
          ` (${problems.length} problems in all), first few:`,
        ...problems.slice(0, 8),
      ].join("\n  ");
      expect(brokenScenarios, report).toBe(0);
    }, SWEEP_TIMEOUT_MS);
  }
});
