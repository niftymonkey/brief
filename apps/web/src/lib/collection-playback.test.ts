import { describe, expect, it } from "vitest";
import {
  ARMING_TIMEOUT_MS,
  BOUNDARY_POLL_INTERVAL_MS,
  FAILURE_ADVANCE_DELAY_MS,
  PLAYER_STATE,
  REBUFFER_TIMEOUT_MS,
  STALLED_ERROR_CODE,
  STALL_TIMEOUT_MS,
  THROTTLED_POLL_INTERVAL_MS,
  describePlaybackError,
  describeSittingPosition,
  initialPlaybackState,
  readSittingPosition,
  reducePlayback,
  type PlaybackEffect,
  type PlaybackEvent,
  type PlaybackItem,
  type PlaybackState,
} from "./collection-playback";

const ITEMS: PlaybackItem[] = [
  { id: "a", videoId: "aqz-KE-bpKQ", startSec: 30, endSec: 72 },
  { id: "b", videoId: "M7lc1UVf-VE", startSec: 5, endSec: 40 },
  { id: "c", videoId: "ImRy_PiXstI", startSec: null, endSec: null },
  { id: "d", videoId: "hTWKbfoikeg", startSec: 10, endSec: 30 },
  { id: "e", videoId: "n3V3LZh_r40", startSec: 0, endSec: 10 },
];

/** Applies a scripted event sequence, collecting every effect the reducer asked for. */
function run(
  events: PlaybackEvent[],
  items: PlaybackItem[] = ITEMS,
  from: PlaybackState = initialPlaybackState(),
): { state: PlaybackState; effects: PlaybackEffect[] } {
  let state = from;
  const effects: PlaybackEffect[] = [];
  for (const event of events) {
    const transition = reducePlayback(state, event, items);
    state = transition.state;
    effects.push(...transition.effects);
  }
  return { state, effects };
}

/** Indices of every item the reducer put on screen, however it put it there. */
function loads(effects: PlaybackEffect[]): number[] {
  return effects
    .filter((effect) => effect.kind === "load" || effect.kind === "seek")
    .map((effect) => (effect.kind === "load" || effect.kind === "seek" ? effect.index : -1));
}

const playing = (currentTime: number, videoId: string): PlaybackEvent => ({
  kind: "playerState",
  state: PLAYER_STATE.PLAYING,
  currentTime,
  videoId,
});

const ended = (currentTime: number, videoId: string): PlaybackEvent => ({
  kind: "playerState",
  state: PLAYER_STATE.ENDED,
  currentTime,
  videoId,
});

const tick = (currentTime: number, videoId: string): PlaybackEvent => ({
  kind: "tick",
  state: PLAYER_STATE.PLAYING,
  currentTime,
  videoId,
});

describe("initialPlaybackState", () => {
  it("starts idle with no current item and no failures", () => {
    const state = initialPlaybackState();
    expect(state.status).toBe("idle");
    expect(state.index).toBe(-1);
    expect(state.armed).toBe(false);
    expect(state.failures).toEqual([]);
  });
});

describe("start", () => {
  it("loads and plays the first item on the user gesture", () => {
    const { state, effects } = run([{ kind: "start" }]);
    expect(state.status).toBe("loading");
    expect(state.index).toBe(0);
    expect(state.armed).toBe(false);
    expect(effects).toEqual([
      { kind: "load", index: 0, item: ITEMS[0], generation: state.generation },
      { kind: "scheduleArmingTimeout", generation: state.generation, delayMs: ARMING_TIMEOUT_MS },
      { kind: "play" },
    ]);
  });

  it("finishes immediately when the collection has no items", () => {
    const { state, effects } = run([{ kind: "start" }], []);
    expect(state.status).toBe("done");
    expect(effects).toEqual([{ kind: "pause" }, { kind: "finish" }]);
  });

  it("is a no-op while a sitting is already running", () => {
    const { state, effects } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      { kind: "start" },
    ]);
    expect(state.index).toBe(0);
    expect(loads(effects)).toEqual([0]);
  });

  it("restarts from the top once the sitting is done", () => {
    const done = run(
      [{ kind: "start" }, playing(0, "n3V3LZh_r40"), ended(10, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(done.state.status).toBe("done");

    const restarted = run([{ kind: "start" }], [ITEMS[4]], done.state);
    expect(restarted.state.status).toBe("loading");
    expect(restarted.state.index).toBe(0);
    expect(loads(restarted.effects)).toEqual([0]);
  });

  it("puts the first item back on screen with a load, not a seek within a player it left", () => {
    const done = run(
      [{ kind: "start" }, playing(0, "n3V3LZh_r40"), ended(10, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(done.state.status).toBe("done");
    // The finished sitting was paused and torn down, so nothing is on screen to seek
    // within, and a load that thinks otherwise never puts the video back.
    expect(done.state.loadedVideoId).toBeNull();

    const restarted = run([{ kind: "start" }], [ITEMS[4]], done.state);
    expect(restarted.state.loadKind).toBe("load");
    expect(restarted.effects.map((effect) => effect.kind)).toEqual([
      "load",
      "scheduleArmingTimeout",
      "play",
    ]);
  });
});

describe("arming", () => {
  it("does not arm an item until the player reports it playing", () => {
    const { state } = run([{ kind: "start" }]);
    expect(state.armed).toBe(false);
    expect(state.status).toBe("loading");
  });

  it("arms on the item's own PLAYING callback", () => {
    const { state } = run([{ kind: "start" }, playing(30.067, "aqz-KE-bpKQ")]);
    expect(state.armed).toBe(true);
    expect(state.status).toBe("playing");
  });

  it("never arms a freshly loaded video from the poll, however the player looks", () => {
    const { state } = run([
      { kind: "start" },
      tick(30.1, "aqz-KE-bpKQ"),
      tick(31.1, "aqz-KE-bpKQ"),
      tick(40, "aqz-KE-bpKQ"),
    ]);
    expect(state.armed).toBe(false);
    expect(state.index).toBe(0);
  });

  it("ignores a PLAYING that reports a video this item is not", () => {
    const { state } = run([{ kind: "start" }, playing(30, "M7lc1UVf-VE")]);
    expect(state.armed).toBe(false);
  });
});

describe("boundary detection", () => {
  it("advances when the poll crosses endSec while playing", () => {
    const { state, effects } = run([
      { kind: "start" },
      playing(30.067, "aqz-KE-bpKQ"),
      tick(71.9, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
    ]);
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("ignores a poll tick before the item's own PLAYING has armed it", () => {
    const { state, effects } = run([{ kind: "start" }, tick(72.5, "aqz-KE-bpKQ")]);
    expect(state.index).toBe(0);
    expect(loads(effects)).toEqual([0]);
  });

  it("ignores a poll tick while the player is not playing", () => {
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      { kind: "tick", state: PLAYER_STATE.BUFFERING, currentTime: 99, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(state.index).toBe(0);
  });

  it("advances a whole-range item on its natural ENDED", () => {
    const { state, effects } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      playing(5.02, "M7lc1UVf-VE"),
      tick(40.004, "M7lc1UVf-VE"),
      playing(0.006, "ImRy_PiXstI"),
      ended(32.121, "ImRy_PiXstI"),
    ]);
    expect(state.index).toBe(3);
    expect(loads(effects)).toEqual([0, 1, 2, 3]);
  });

  it("takes an ENDED after arming as this item's end, whatever time it reports", () => {
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      ended(72.0, "aqz-KE-bpKQ"),
    ]);
    expect(state.index).toBe(1);
  });

  it("finishes after the last item's boundary", () => {
    const { state, effects } = run(
      [{ kind: "start" }, playing(0.058, "n3V3LZh_r40"), tick(10.003, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(state.status).toBe("done");
    expect(effects.at(-1)).toEqual({ kind: "finish" });
  });
});

describe("a viewer's own pause", () => {
  const paused = (currentTime: number, duration?: number): PlaybackEvent => ({
    kind: "tick",
    state: PLAYER_STATE.PAUSED,
    currentTime,
    videoId: "aqz-KE-bpKQ",
    duration,
  });

  it("holds the sitting on the item rather than moving past it", () => {
    const { state } = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ"), paused(45, 400)]);
    expect(state.index).toBe(0);
    expect(state.status).toBe("playing");
  });

  it("never times out, however long the viewer leaves it paused", () => {
    const paddedTicks = Math.ceil(STALL_TIMEOUT_MS / BOUNDARY_POLL_INTERVAL_MS) * 3;
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      ...Array.from({ length: paddedTicks }, () => paused(45, 400)),
    ]);
    expect(state.index).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.failures).toEqual([]);
  });

  it("does not move on from a pause the player reports no duration for", () => {
    const { state } = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ"), paused(71.9)]);
    expect(state.index).toBe(0);
  });
});

describe("an item that runs out of video", () => {
  const OVERLONG: PlaybackItem[] = [
    { id: "over", videoId: "aqz-KE-bpKQ", startSec: 10, endSec: 300 },
    { id: "next", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  const settled = (state: number, currentTime: number, duration: number): PlaybackEvent => ({
    kind: "tick",
    state,
    currentTime,
    videoId: "aqz-KE-bpKQ",
    duration,
  });

  it("moves on when the poll finds the player settled in ENDED", () => {
    const { state, effects } = run(
      [{ kind: "start" }, playing(10.2, "aqz-KE-bpKQ"), settled(PLAYER_STATE.ENDED, 22, 22)],
      OVERLONG,
    );
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("moves on when the poll finds the player parked at the video's own end", () => {
    const { state } = run(
      [{ kind: "start" }, playing(10.2, "aqz-KE-bpKQ"), settled(PLAYER_STATE.PAUSED, 21.9, 22)],
      OVERLONG,
    );
    expect(state.index).toBe(1);
  });

  it("moves on when the poll finds the player cued at the video's own end", () => {
    const { state } = run(
      [{ kind: "start" }, playing(10.2, "aqz-KE-bpKQ"), settled(PLAYER_STATE.CUED, 22, 22)],
      OVERLONG,
    );
    expect(state.index).toBe(1);
  });

  it("does not move on while the player is still buffering near the end", () => {
    const { state } = run(
      [{ kind: "start" }, playing(10.2, "aqz-KE-bpKQ"), settled(PLAYER_STATE.BUFFERING, 21.9, 22)],
      OVERLONG,
    );
    expect(state.index).toBe(0);
  });
});

describe("race guard against stale terminal events", () => {
  it("ignores the previous item's ENDED that lands after the next load", () => {
    // Straight from the spike log: item 0's terminal event arrives a few ms after the
    // poll already advanced and loaded item 1, and getVideoData() by then reports item 1.
    const { state, effects } = run([
      { kind: "start" },
      playing(30.067, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      ended(72.003, "M7lc1UVf-VE"),
      playing(5.023, "M7lc1UVf-VE"),
      tick(40.004, "M7lc1UVf-VE"),
    ]);
    expect(loads(effects)).toEqual([0, 1, 2]);
    expect(state.index).toBe(2);
  });

  it("ignores the spurious ENDED at t=0 on a fresh load", () => {
    const { state, effects } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      ended(0, "M7lc1UVf-VE"),
      ended(0, "M7lc1UVf-VE"),
    ]);
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("ignores a stale tick that still reports the previous video id", () => {
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      playing(5, "M7lc1UVf-VE"),
      tick(72.2, "aqz-KE-bpKQ"),
    ]);
    expect(state.index).toBe(1);
  });

  it("still advances when the player reports no video id", () => {
    const { state } = run([
      { kind: "start" },
      { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 30 },
      { kind: "tick", state: PLAYER_STATE.PLAYING, currentTime: 72.1 },
    ]);
    expect(state.index).toBe(1);
  });
});

describe("two ranges cut from the same video", () => {
  const VIDEO = "dQw4w9WgXcQ";

  const IN_ORDER: PlaybackItem[] = [
    { id: "s1", videoId: VIDEO, startSec: 0, endSec: 10 },
    { id: "s2", videoId: VIDEO, startSec: 20, endSec: 30 },
    { id: "s3", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  const OUT_OF_ORDER: PlaybackItem[] = [
    { id: "r1", videoId: VIDEO, startSec: 20, endSec: 30 },
    { id: "r2", videoId: VIDEO, startSec: 0, endSec: 10 },
    { id: "r3", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  it("moves the video already on screen rather than loading it again", () => {
    const { effects } = run([{ kind: "start" }, playing(0.1, VIDEO), tick(10.02, VIDEO)], IN_ORDER);
    expect(effects.filter((effect) => effect.kind === "seek")).toEqual([
      { kind: "seek", index: 1, item: IN_ORDER[1], generation: 2, toSec: 20 },
    ]);
    expect(effects).not.toContainEqual(expect.objectContaining({ kind: "load", index: 1 }));
  });

  it("does not let a terminal event from the first range skip the second range", () => {
    // The callback reports the position the player was at when it fired, which is the
    // first range's tail, while the id it carries is the one video both ranges share.
    const { state, effects } = run(
      [
        { kind: "start" },
        playing(0.1, VIDEO),
        tick(10.02, VIDEO),
        playing(20.03, VIDEO),
        ended(10.04, VIDEO),
      ],
      IN_ORDER,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(true);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("still takes the second range's own end when the video really does run out", () => {
    // The poll takes it, not the callback: on one video a terminal callback from the
    // range before this one is indistinguishable from this range's own.
    const { state } = run(
      [
        { kind: "start" },
        playing(0.1, VIDEO),
        tick(10.02, VIDEO),
        playing(20.03, VIDEO),
        { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 24.5, videoId: VIDEO },
      ],
      IN_ORDER,
    );
    expect(state.index).toBe(2);
  });

  it("does not let the first range's trailing PLAYING arm the second range", () => {
    const { state, effects } = run(
      [
        { kind: "start" },
        playing(20.1, VIDEO),
        tick(30.02, VIDEO),
        playing(30.05, VIDEO),
        tick(30.06, VIDEO),
      ],
      OUT_OF_ORDER,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(false);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("arms the second range once the seek lands, with no callback of its own", () => {
    const { state } = run(
      [
        { kind: "start" },
        playing(20.1, VIDEO),
        tick(30.02, VIDEO),
        tick(30.06, VIDEO),
        tick(0.12, VIDEO),
      ],
      OUT_OF_ORDER,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(true);
  });

  it("plays the second range once the player reaches it", () => {
    const { state, effects } = run(
      [
        { kind: "start" },
        playing(0.1, VIDEO),
        tick(10.02, VIDEO),
        playing(20.03, VIDEO),
        tick(30.01, VIDEO),
      ],
      IN_ORDER,
    );
    expect(state.index).toBe(2);
    expect(loads(effects)).toEqual([0, 1, 2]);
  });
});

describe("contiguous ranges of one video", () => {
  const VIDEO = "dQw4w9WgXcQ";

  const CONTIGUOUS: PlaybackItem[] = [
    { id: "k1", videoId: VIDEO, startSec: 10, endSec: 20 },
    { id: "k2", videoId: VIDEO, startSec: 20, endSec: 30 },
    { id: "k3", videoId: VIDEO, startSec: 30, endSec: 40 },
  ];

  const poll = (state: number, currentTime: number): PlaybackEvent => ({
    kind: "tick",
    state,
    currentTime,
    videoId: VIDEO,
    duration: 120,
  });

  /**
   * The outgoing range runs past its end while the seek is still in flight, so the
   * poll reads its tail where the incoming range's own first frames live.
   */
  const OVERSHOOT_INTO_THE_NEXT_RANGE: PlaybackEvent[] = [
    { kind: "start" },
    playing(10, VIDEO),
    poll(PLAYER_STATE.PLAYING, 19.86),
    poll(PLAYER_STATE.PLAYING, 20.02),
    poll(PLAYER_STATE.PLAYING, 20.22),
  ];

  it("does not let the outgoing range's overshoot carry the poll past the next range", () => {
    const { state, effects } = run(OVERSHOOT_INTO_THE_NEXT_RANGE, CONTIGUOUS);
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
    expect(state.failures).toEqual([]);
  });

  it("plays the range the overshoot nearly skipped, right through to its own end", () => {
    const overshot = run(OVERSHOOT_INTO_THE_NEXT_RANGE, CONTIGUOUS);
    const resumed = run(
      [poll(PLAYER_STATE.PLAYING, 25), poll(PLAYER_STATE.PLAYING, 30.02)],
      CONTIGUOUS,
      overshot.state,
    );
    expect(resumed.state.index).toBe(2);
    expect(loads(resumed.effects)).toEqual([2]);
  });
});

describe("a whole-range item following a range of the same video", () => {
  const VIDEO = "dQw4w9WgXcQ";

  const RANGE_THEN_WHOLE: PlaybackItem[] = [
    { id: "w1", videoId: VIDEO, startSec: 10, endSec: 20 },
    { id: "w2", videoId: VIDEO, startSec: null, endSec: null },
    { id: "w3", videoId: "M7lc1UVf-VE", startSec: null, endSec: null },
  ];

  it("does not arm the whole-range item off the outgoing range's poll sample", () => {
    const { state, effects } = run(
      [
        { kind: "start" },
        playing(10, VIDEO),
        tick(20.02, VIDEO),
        // The poll is still reading the range that just ended: the seek has not taken
        // effect yet, and on one video only the position tells them apart.
        tick(20.06, VIDEO),
        ended(0, VIDEO),
      ],
      RANGE_THEN_WHOLE,
    );
    expect(state.index).toBe(1);
    expect(state.status).toBe("loading");
    expect(state.armed).toBe(false);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("arms the whole-range item from the first sample of its own seek", () => {
    const { state } = run(
      [
        { kind: "start" },
        playing(10, VIDEO),
        tick(20.02, VIDEO),
        tick(20.06, VIDEO),
        tick(0.2, VIDEO),
      ],
      RANGE_THEN_WHOLE,
    );
    expect(state.index).toBe(1);
    expect(state.status).toBe("playing");
    expect(state.armed).toBe(true);
  });

  it("still arms a following range that legitimately starts where the last one ended", () => {
    const CONTIGUOUS: PlaybackItem[] = [
      { id: "c1", videoId: VIDEO, startSec: 10, endSec: 20 },
      { id: "c2", videoId: VIDEO, startSec: 20, endSec: 30 },
    ];
    const { state } = run(
      [{ kind: "start" }, playing(10, VIDEO), tick(20.02, VIDEO), tick(20.06, VIDEO)],
      CONTIGUOUS,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(true);
  });
});

describe("the same whole video twice in a row", () => {
  const VIDEO = "dQw4w9WgXcQ";

  const TWICE: PlaybackItem[] = [
    { id: "t1", videoId: VIDEO, startSec: null, endSec: null },
    { id: "t2", videoId: VIDEO, startSec: null, endSec: null },
    { id: "t3", videoId: "M7lc1UVf-VE", startSec: null, endSec: null },
  ];

  /** The first pass runs out and the poll reads its tail before the seek lands. */
  const TAIL_OF_THE_FIRST_PASS: PlaybackEvent[] = [
    { kind: "start" },
    playing(0.1, VIDEO),
    ended(180, VIDEO),
    tick(179.94, VIDEO),
  ];

  it("does not let the first pass's tail arm the second pass", () => {
    const { state } = run(TAIL_OF_THE_FIRST_PASS, TWICE);
    expect(state.index).toBe(1);
    expect(state.armed).toBe(false);
  });

  it("does not let the first pass's terminal event then carry the sitting off the second", () => {
    const { state, effects } = run([...TAIL_OF_THE_FIRST_PASS, ended(180, VIDEO)], TWICE);
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
    expect(state.failures).toEqual([]);
  });

  it("arms the second pass from the first sample of its own seek", () => {
    const { state } = run([...TAIL_OF_THE_FIRST_PASS, tick(0.2, VIDEO)], TWICE);
    expect(state.index).toBe(1);
    expect(state.armed).toBe(true);
  });
});

describe("an item that never starts playing", () => {
  // startSec past the real length: the video was re-uploaded shorter after the item
  // was saved, so the player settles at its own end and never plays this range.
  const UNREACHABLE: PlaybackItem[] = [
    { id: "gone", videoId: "aqz-KE-bpKQ", startSec: 4000, endSec: 4100 },
    { id: "next", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  it("schedules an arming watchdog with every load", () => {
    const { state, effects } = run([{ kind: "start" }], UNREACHABLE);
    expect(effects).toContainEqual({
      kind: "scheduleArmingTimeout",
      generation: state.generation,
      delayMs: ARMING_TIMEOUT_MS,
    });
  });

  it("records a visible failure and moves on when the watchdog fires", () => {
    const started = run(
      [
        { kind: "start" },
        { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 22, videoId: "aqz-KE-bpKQ" },
        { kind: "playerState", state: PLAYER_STATE.PAUSED, currentTime: 22, videoId: "aqz-KE-bpKQ" },
      ],
      UNREACHABLE,
    );
    expect(started.state.status).toBe("loading");

    const timedOut = run(
      [{ kind: "armingTimeout", generation: started.state.generation }],
      UNREACHABLE,
      started.state,
    );
    expect(timedOut.state.status).toBe("failed");
    expect(timedOut.state.failures).toEqual([
      {
        itemId: "gone",
        index: 0,
        code: STALLED_ERROR_CODE,
        reason: describePlaybackError(STALLED_ERROR_CODE),
      },
    ]);
    expect(timedOut.effects).toEqual([
      {
        kind: "scheduleFailureAdvance",
        generation: timedOut.state.generation,
        delayMs: FAILURE_ADVANCE_DELAY_MS,
      },
    ]);

    const advanced = run(
      [{ kind: "failureAdvance", generation: timedOut.state.generation }],
      UNREACHABLE,
      timedOut.state,
    );
    expect(advanced.state.index).toBe(1);
    expect(loads(advanced.effects)).toEqual([1]);
  });

  it("names the stall in a reason of its own", () => {
    expect(describePlaybackError(STALLED_ERROR_CODE)).not.toBe(describePlaybackError(999));
  });

  it("ignores a watchdog for an item that has already armed", () => {
    const started = run([{ kind: "start" }, playing(0, "M7lc1UVf-VE")], [UNREACHABLE[1]]);
    const timedOut = run(
      [{ kind: "armingTimeout", generation: started.state.generation }],
      [UNREACHABLE[1]],
      started.state,
    );
    expect(timedOut.state.status).toBe("playing");
    expect(timedOut.state.failures).toEqual([]);
  });

  it("ignores a watchdog from a generation the sitting has left behind", () => {
    const started = run([{ kind: "start" }], UNREACHABLE);
    const staleGeneration = started.state.generation;
    const skipped = run([{ kind: "skip" }], UNREACHABLE, started.state);
    const timedOut = run(
      [{ kind: "armingTimeout", generation: staleGeneration }],
      UNREACHABLE,
      skipped.state,
    );
    expect(timedOut.state.failures).toEqual([]);
    expect(timedOut.effects).toEqual([]);
  });
});

describe("an item that stops making progress after it started", () => {
  const STALLING: PlaybackItem[] = [
    { id: "stuck", videoId: "aqz-KE-bpKQ", startSec: 10, endSec: 40 },
    { id: "next", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  const STALL_TICKS = Math.ceil(STALL_TIMEOUT_MS / BOUNDARY_POLL_INTERVAL_MS);
  const REBUFFER_TICKS = Math.ceil(REBUFFER_TIMEOUT_MS / BOUNDARY_POLL_INTERVAL_MS);

  const buffering = (currentTime: number): PlaybackEvent => ({
    kind: "tick",
    state: PLAYER_STATE.BUFFERING,
    currentTime,
    videoId: "aqz-KE-bpKQ",
    duration: 400,
  });

  it("gives a buffering player the whole stall window before giving up on it", () => {
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: STALL_TICKS }, () => buffering(12)),
      ],
      STALLING,
    );
    expect(state.status).toBe("playing");
    expect(state.failures).toEqual([]);
  });

  it("records a failure and moves on once the player has frozen for the whole window", () => {
    const stalled = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: REBUFFER_TICKS + 1 }, () => buffering(12)),
      ],
      STALLING,
    );
    expect(stalled.state.status).toBe("failed");
    expect(stalled.state.failures).toEqual([
      {
        itemId: "stuck",
        index: 0,
        code: STALLED_ERROR_CODE,
        reason: describePlaybackError(STALLED_ERROR_CODE),
      },
    ]);

    const advanced = run(
      [{ kind: "failureAdvance", generation: stalled.state.generation }],
      STALLING,
      stalled.state,
    );
    expect(advanced.state.index).toBe(1);
    expect(loads(advanced.effects)).toEqual([1]);
  });

  it("forgets the stall as soon as the player moves again", () => {
    // Every tick here reports the player buffering, so the counter is measured against
    // the rebuffer budget throughout. Both runs of buffering stop one tick short of
    // that budget, which is what makes the progress tick between them load-bearing: a
    // counter that carried its first run's total across would cross the budget partway
    // through the second run and record the item as stalled.
    const ticksJustUnderBudget = REBUFFER_TICKS - 1;
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: ticksJustUnderBudget }, () => buffering(12)),
        tick(12.2, "aqz-KE-bpKQ"),
        ...Array.from({ length: ticksJustUnderBudget }, () => buffering(12.2)),
      ],
      STALLING,
    );
    expect(state.status).toBe("playing");
    expect(state.failures).toEqual([]);
    // Only the second run is on the counter, so the first run really was forgotten
    // rather than merely left under the budget.
    expect(state.stalledMs).toBe(ticksJustUnderBudget * BOUNDARY_POLL_INTERVAL_MS);
  });
});

describe("a zero-length range", () => {
  const ZERO_LENGTH: PlaybackItem[] = [
    { id: "point", videoId: "aqz-KE-bpKQ", startSec: 30, endSec: 30 },
    { id: "after", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  it("arms from a callback at the point it was seeked to", () => {
    const { state } = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")], ZERO_LENGTH);
    expect(state.status).toBe("playing");
    expect(state.armed).toBe(true);
  });

  it("moves on at the next poll instead of stalling on the point", () => {
    const { state, effects } = run(
      [{ kind: "start" }, playing(30.01, "aqz-KE-bpKQ"), tick(30.2, "aqz-KE-bpKQ")],
      ZERO_LENGTH,
    );
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
  });
});

describe("prev", () => {
  it("goes back to the item before the one on screen", () => {
    const started = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")]);
    const back = run([{ kind: "skip" }, { kind: "prev" }], ITEMS, started.state);

    expect(back.state.index).toBe(0);
    expect(loads(back.effects)).toEqual([1, 0]);
  });

  it("restarts the first item rather than falling off the top of the sitting", () => {
    const started = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")]);
    const back = run([{ kind: "prev" }], ITEMS, started.state);

    expect(back.state.index).toBe(0);
    expect(loads(back.effects)).toEqual([0]);
  });

  it("takes a finished sitting back to the item it ended on", () => {
    const done = run(
      [{ kind: "start" }, playing(0.058, "n3V3LZh_r40"), tick(10.003, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(done.state.status).toBe("done");

    const back = run([{ kind: "prev" }], [ITEMS[4]], done.state);
    expect(back.state.status).toBe("loading");
    expect(back.state.index).toBe(0);
  });

  it("has nothing to go back to before the sitting has started", () => {
    const { state, effects } = run([{ kind: "prev" }]);
    expect(state.status).toBe("idle");
    expect(effects).toEqual([]);
  });
});

describe("readSittingPosition", () => {
  it("names no item before the first one loads", () => {
    const position = readSittingPosition(initialPlaybackState(), ITEMS);
    expect(position).toEqual({ itemId: null, ordinal: null, total: 5, isDone: false });
  });

  it("names the item the player is on", () => {
    const { state } = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")]);
    expect(readSittingPosition(state, ITEMS)).toEqual({
      itemId: "a",
      ordinal: 1,
      total: 5,
      isDone: false,
    });
  });

  it("keeps naming the item the failure banner just disowned", () => {
    const { state } = run([
      { kind: "start" },
      { kind: "playerError", code: 150, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(state.status).toBe("failed");
    expect(readSittingPosition(state, ITEMS).ordinal).toBe(1);
  });

  it("names no item once the sitting is over", () => {
    const done = run(
      [{ kind: "start" }, playing(0.058, "n3V3LZh_r40"), tick(10.003, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(readSittingPosition(done.state, [ITEMS[4]])).toEqual({
      itemId: null,
      ordinal: null,
      total: 1,
      isDone: true,
    });
  });
});

describe("describeSittingPosition", () => {
  it("counts the item the player is on", () => {
    expect(
      describeSittingPosition({ itemId: "b", ordinal: 2, total: 5, isDone: false }),
    ).toBe("2 of 5");
  });

  it("opens on the first item before the sitting has one on screen", () => {
    expect(
      describeSittingPosition({ itemId: null, ordinal: null, total: 5, isDone: false }),
    ).toBe("1 of 5");
  });

  it("rests on the last item once the sitting is over", () => {
    expect(
      describeSittingPosition({ itemId: null, ordinal: null, total: 5, isDone: true }),
    ).toBe("5 of 5");
  });
});

describe("unplayable items", () => {
  it("records a visible failure and schedules the advance instead of skipping silently", () => {
    const start = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      playing(5, "M7lc1UVf-VE"),
      tick(40.004, "M7lc1UVf-VE"),
      playing(0, "ImRy_PiXstI"),
      ended(32.121, "ImRy_PiXstI"),
      { kind: "playerError", code: 150, videoId: "hTWKbfoikeg" },
    ]);

    expect(start.state.status).toBe("failed");
    expect(start.state.index).toBe(3);
    expect(start.state.failures).toEqual([
      { itemId: "d", index: 3, code: 150, reason: describePlaybackError(150) },
    ]);
    expect(start.effects.at(-1)).toEqual({
      kind: "scheduleFailureAdvance",
      generation: start.state.generation,
      delayMs: FAILURE_ADVANCE_DELAY_MS,
    });

    const resumed = run(
      [
        { kind: "failureAdvance", generation: start.state.generation },
        playing(0.058, "n3V3LZh_r40"),
        tick(10.003, "n3V3LZh_r40"),
      ],
      ITEMS,
      start.state,
    );
    expect(loads(resumed.effects)).toEqual([4]);
    expect(resumed.state.status).toBe("done");
    expect(resumed.state.failures).toHaveLength(1);
  });

  it("never stalls: the failure pause is the only wait before the next item", () => {
    const failed = run([
      { kind: "start" },
      { kind: "playerError", code: 101, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(failed.state.status).toBe("failed");
    const advanced = run(
      [{ kind: "failureAdvance", generation: failed.state.generation }],
      ITEMS,
      failed.state,
    );
    expect(advanced.state.index).toBe(1);
    expect(advanced.state.status).toBe("loading");
  });

  it("ignores a stale failureAdvance from an earlier generation", () => {
    const failed = run([
      { kind: "start" },
      { kind: "playerError", code: 100, videoId: "aqz-KE-bpKQ" },
    ]);
    const staleGeneration = failed.state.generation;
    const advanced = run(
      [{ kind: "failureAdvance", generation: staleGeneration }],
      ITEMS,
      failed.state,
    );
    const replayed = run(
      [{ kind: "failureAdvance", generation: staleGeneration }],
      ITEMS,
      advanced.state,
    );
    expect(replayed.state.index).toBe(1);
    expect(loads(replayed.effects)).toEqual([]);
  });

  it("records only one failure per item even if onError repeats", () => {
    const { state } = run([
      { kind: "start" },
      { kind: "playerError", code: 150, videoId: "aqz-KE-bpKQ" },
      { kind: "playerError", code: 150, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(state.failures).toHaveLength(1);
  });

  it("finishes the sitting when the last item is the one that fails", () => {
    const failed = run(
      [{ kind: "start" }, { kind: "playerError", code: 150, videoId: "n3V3LZh_r40" }],
      [ITEMS[4]],
    );
    const advanced = run(
      [{ kind: "failureAdvance", generation: failed.state.generation }],
      [ITEMS[4]],
      failed.state,
    );
    expect(advanced.state.status).toBe("done");
    expect(advanced.effects).toEqual([{ kind: "pause" }, { kind: "finish" }]);
    expect(advanced.state.failures).toHaveLength(1);
  });

  it("ignores an error that arrives for an item already left behind", () => {
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      tick(72.003, "aqz-KE-bpKQ"),
      { kind: "playerError", code: 150, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(state.failures).toEqual([]);
    expect(state.status).toBe("loading");
  });

  it("names every code the spike calls out", () => {
    for (const code of [2, 5, 100, 101, 150, 153]) {
      expect(describePlaybackError(code)).not.toBe(describePlaybackError(999));
      expect(describePlaybackError(code).length).toBeGreaterThan(0);
    }
  });
});

describe("manual control", () => {
  it("skips the current item on demand", () => {
    const { state, effects } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      { kind: "skip" },
    ]);
    expect(state.index).toBe(1);
    expect(loads(effects)).toEqual([0, 1]);
  });

  it("skips out of a failed item without waiting for the pause", () => {
    const { state } = run([
      { kind: "start" },
      { kind: "playerError", code: 150, videoId: "aqz-KE-bpKQ" },
      { kind: "skip" },
    ]);
    expect(state.index).toBe(1);
    expect(state.status).toBe("loading");
  });

  it("stops back to idle and invalidates pending timers", () => {
    const running = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")]);
    const stopped = run([{ kind: "stop" }], ITEMS, running.state);
    expect(stopped.state.status).toBe("idle");
    expect(stopped.state.index).toBe(-1);
    expect(stopped.effects).toEqual([{ kind: "pause" }, { kind: "finish" }]);
    expect(stopped.state.generation).not.toBe(running.state.generation);

    const afterStop = run(
      [ended(72, "aqz-KE-bpKQ"), { kind: "tick", state: PLAYER_STATE.PLAYING, currentTime: 99 }],
      ITEMS,
      stopped.state,
    );
    expect(afterStop.effects).toEqual([]);
    expect(afterStop.state.status).toBe("idle");
  });

  it("reloads rather than seeks after a stop, since the player is gone", () => {
    const running = run([{ kind: "start" }, playing(30, "aqz-KE-bpKQ")]);
    const stopped = run([{ kind: "stop" }], ITEMS, running.state);
    const restarted = run([{ kind: "start" }], ITEMS, stopped.state);
    expect(restarted.effects[0]).toEqual({
      kind: "load",
      index: 0,
      item: ITEMS[0],
      generation: restarted.state.generation,
    });
  });
});

/**
 * A callback's position is read when it fires and everything beside it when it lands,
 * so a callback the outgoing entry fired can reach the reducer wearing the incoming
 * entry's id. Every case below is one the sweep found and no example test had.
 */
describe("a callback carrying the outgoing entry's clock and the incoming entry's id", () => {
  const SHORT = "aqz-KE-bpKQ";
  const OTHER = "M7lc1UVf-VE";

  const WHOLE_TWICE_THEN_OTHER: PlaybackItem[] = [
    { id: "w1", videoId: SHORT, startSec: null, endSec: null },
    { id: "w2", videoId: SHORT, startSec: null, endSec: null },
    { id: "w3", videoId: OTHER, startSec: null, endSec: null },
  ];

  /** Up to the point where the third entry has been loaded and nothing has armed it. */
  const THIRD_ENTRY_LOADED: PlaybackEvent[] = [
    { kind: "start" },
    { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 0, videoId: SHORT, duration: 22 },
    { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 22, videoId: SHORT, duration: 22 },
    { kind: "tick", state: PLAYER_STATE.PLAYING, currentTime: 0.02, videoId: SHORT, duration: 22 },
    { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 22, videoId: SHORT, duration: 22 },
  ];

  it("does not let the second pass's trailing PLAYING arm the entry after it", () => {
    const { state } = run(
      [
        ...THIRD_ENTRY_LOADED,
        // Fired while the second pass was still on screen, delivered once the third
        // entry's video was: 21.92s into a video the third entry's is 15s long.
        {
          kind: "playerState",
          state: PLAYER_STATE.PLAYING,
          currentTime: 21.92,
          videoId: OTHER,
          duration: 15,
        },
        {
          kind: "playerState",
          state: PLAYER_STATE.ENDED,
          currentTime: 22,
          videoId: OTHER,
          duration: 15,
        },
      ],
      WHOLE_TWICE_THEN_OTHER,
    );
    expect(state.index).toBe(2);
    expect(state.armed).toBe(false);
    expect(state.status).toBe("loading");
  });

  it("still arms the entry after it from its own first frames", () => {
    const stale = run(
      [
        ...THIRD_ENTRY_LOADED,
        {
          kind: "playerState",
          state: PLAYER_STATE.PLAYING,
          currentTime: 21.92,
          videoId: OTHER,
          duration: 15,
        },
      ],
      WHOLE_TWICE_THEN_OTHER,
    );
    const own = run(
      [
        {
          kind: "playerState",
          state: PLAYER_STATE.PLAYING,
          currentTime: 0.03,
          videoId: OTHER,
          duration: 15,
        },
      ],
      WHOLE_TWICE_THEN_OTHER,
      stale.state,
    );
    expect(own.state.index).toBe(2);
    expect(own.state.armed).toBe(true);
  });

  it("does not act on a sample the player would not name a video for", () => {
    const PAIR: PlaybackItem[] = [
      { id: "p1", videoId: SHORT, startSec: 10, endSec: 20 },
      { id: "p2", videoId: OTHER, startSec: 5, endSec: 15 },
    ];
    // getVideoData() throws while the player exchanges modules, which is exactly the
    // window a callback from the entry before this one arrives in.
    const { state } = run(
      [
        { kind: "start" },
        { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 10, videoId: SHORT },
        { kind: "tick", state: PLAYER_STATE.PLAYING, currentTime: 20.1, videoId: SHORT },
        { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 20.3, videoId: null },
        { kind: "tick", state: PLAYER_STATE.PLAYING, currentTime: 20.5, videoId: null },
      ],
      PAIR,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(false);
    expect(state.failures).toEqual([]);
  });

  it("refuses an end reported from behind where the item was sent", () => {
    // A live stream reports no length at all, so the position an event carries is the
    // only thing left to judge it by: an item sent to 30s cannot have ended at 0.
    const { state } = run([
      { kind: "start" },
      playing(30, "aqz-KE-bpKQ"),
      { kind: "playerState", state: PLAYER_STATE.ENDED, currentTime: 0, videoId: "aqz-KE-bpKQ" },
      { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 0, videoId: "aqz-KE-bpKQ" },
    ]);
    expect(state.index).toBe(0);
    expect(state.armed).toBe(true);
  });

  it("refuses an end the loaded video is too short to have reached", () => {
    const BOTH_WHOLE: PlaybackItem[] = [
      { id: "long", videoId: SHORT, startSec: null, endSec: null },
      { id: "short", videoId: OTHER, startSec: null, endSec: null },
    ];
    const { state } = run(
      [
        { kind: "start" },
        { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 0, videoId: SHORT, duration: 22 },
        { kind: "tick", state: PLAYER_STATE.ENDED, currentTime: 22, videoId: SHORT, duration: 22 },
        // The second entry armed first; the first entry's own ENDED arrives after it.
        {
          kind: "playerState",
          state: PLAYER_STATE.PLAYING,
          currentTime: 0.02,
          videoId: OTHER,
          duration: 15,
        },
        {
          kind: "playerState",
          state: PLAYER_STATE.ENDED,
          currentTime: 22,
          videoId: OTHER,
          duration: 15,
        },
      ],
      BOTH_WHOLE,
    );
    expect(state.index).toBe(1);
    expect(state.armed).toBe(true);
  });
});

describe("the end of the sitting", () => {
  it("silences the player instead of leaving it playing under the finished sitting", () => {
    const { state, effects } = run(
      [{ kind: "start" }, playing(0.058, "n3V3LZh_r40"), tick(10.003, "n3V3LZh_r40")],
      [ITEMS[4]],
    );
    expect(state.status).toBe("done");
    expect(effects.slice(-2)).toEqual([{ kind: "pause" }, { kind: "finish" }]);
  });
});

describe("a rebuffer that outlasts the stall window", () => {
  const REBUFFERING: PlaybackItem[] = [
    { id: "slow", videoId: "aqz-KE-bpKQ", startSec: 10, endSec: 40 },
    { id: "next", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  const buffering = (currentTime: number): PlaybackEvent => ({
    kind: "tick",
    state: PLAYER_STATE.BUFFERING,
    currentTime,
    videoId: "aqz-KE-bpKQ",
    duration: 400,
    sinceLastMs: BOUNDARY_POLL_INTERVAL_MS,
  });

  const PAST_THE_STALL_WINDOW =
    Math.ceil(STALL_TIMEOUT_MS / BOUNDARY_POLL_INTERVAL_MS) + 2;

  it("keeps an item whose player is still working on it", () => {
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: PAST_THE_STALL_WINDOW }, () => buffering(12)),
      ],
      REBUFFERING,
    );
    expect(state.status).toBe("playing");
    expect(state.index).toBe(0);
    expect(state.failures).toEqual([]);
  });

  it("does not judge the sample where the player says it is playing again by the shorter window", () => {
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: PAST_THE_STALL_WINDOW }, () => buffering(12)),
        // The player is back but its clock has not caught up with the news.
        {
          kind: "tick",
          state: PLAYER_STATE.PLAYING,
          currentTime: 12,
          videoId: "aqz-KE-bpKQ",
          duration: 400,
          sinceLastMs: BOUNDARY_POLL_INTERVAL_MS,
        },
      ],
      REBUFFERING,
    );
    expect(state.status).toBe("playing");
    expect(state.failures).toEqual([]);
  });

  it("gives up once the rebuffer budget itself is spent", () => {
    const past = Math.ceil(REBUFFER_TIMEOUT_MS / BOUNDARY_POLL_INTERVAL_MS) + 1;
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: past }, () => buffering(12)),
      ],
      REBUFFERING,
    );
    expect(state.status).toBe("failed");
    expect(state.failures).toEqual([
      {
        itemId: "slow",
        index: 0,
        code: STALLED_ERROR_CODE,
        reason: describePlaybackError(STALLED_ERROR_CODE),
      },
    ]);
  });

  it("measures the window in time rather than in samples a hidden tab hands out slowly", () => {
    // A backgrounded tab polls a fifth as often, so the same number of samples covers
    // five times as long and the item is given up on at the same point on the clock.
    const throttled = (currentTime: number): PlaybackEvent => ({
      kind: "tick",
      state: PLAYER_STATE.BUFFERING,
      currentTime,
      videoId: "aqz-KE-bpKQ",
      duration: 400,
      sinceLastMs: THROTTLED_POLL_INTERVAL_MS,
    });
    const samples = Math.ceil(REBUFFER_TIMEOUT_MS / THROTTLED_POLL_INTERVAL_MS) + 1;
    const { state } = run(
      [
        { kind: "start" },
        playing(10.1, "aqz-KE-bpKQ"),
        ...Array.from({ length: samples }, () => throttled(12)),
      ],
      REBUFFERING,
    );
    expect(state.status).toBe("failed");
  });

  it("waits out a rebuffer that happens before the item ever armed", () => {
    const started = run([{ kind: "start" }], REBUFFERING);
    const buffered = run(
      [
        {
          kind: "tick",
          state: PLAYER_STATE.BUFFERING,
          currentTime: 10,
          videoId: "aqz-KE-bpKQ",
          duration: 400,
          sinceLastMs: BOUNDARY_POLL_INTERVAL_MS,
        },
      ],
      REBUFFERING,
      started.state,
    );
    const timedOut = run(
      [{ kind: "armingTimeout", generation: buffered.state.generation }],
      REBUFFERING,
      buffered.state,
    );
    expect(timedOut.state.status).toBe("loading");
    expect(timedOut.state.failures).toEqual([]);
    expect(timedOut.effects).toEqual([
      {
        kind: "scheduleArmingTimeout",
        generation: timedOut.state.generation,
        delayMs: ARMING_TIMEOUT_MS,
      },
    ]);
  });

  it("still gives up on an item that buffers for longer than a rebuffer can last", () => {
    let state = run([{ kind: "start" }], REBUFFERING).state;
    let effects: PlaybackEffect[] = [];
    // The watchdog only ever extends itself while the rebuffer budget has time left in
    // it, so a player that never stops buffering runs out of extensions.
    for (let window = 0; window < 8 && state.status === "loading"; window += 1) {
      const buffered = run(
        [
          {
            kind: "tick",
            state: PLAYER_STATE.BUFFERING,
            currentTime: 10,
            videoId: "aqz-KE-bpKQ",
            duration: 400,
            sinceLastMs: BOUNDARY_POLL_INTERVAL_MS,
          },
          { kind: "armingTimeout", generation: state.generation },
        ],
        REBUFFERING,
        state,
      );
      state = buffered.state;
      effects = buffered.effects;
    }
    expect(state.status).toBe("failed");
    expect(effects.at(-1)).toEqual({
      kind: "scheduleFailureAdvance",
      generation: state.generation,
      delayMs: FAILURE_ADVANCE_DELAY_MS,
    });
  });
});

describe("a viewer who pauses in the closing seconds", () => {
  const VIDEO = "aqz-KE-bpKQ";
  const TO_THE_END: PlaybackItem[] = [
    { id: "tail", videoId: VIDEO, startSec: 90, endSec: null },
    { id: "after", videoId: "M7lc1UVf-VE", startSec: 0, endSec: 5 },
  ];

  const pausedAt = (currentTime: number): PlaybackEvent => ({
    kind: "tick",
    state: PLAYER_STATE.PAUSED,
    currentTime,
    videoId: VIDEO,
    duration: 100,
  });

  it("holds the sitting where the viewer stopped it, short of the video's own end", () => {
    const { state } = run(
      [
        { kind: "start" },
        { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 90, videoId: VIDEO, duration: 100 },
        { kind: "playerState", state: PLAYER_STATE.PAUSED, currentTime: 99.6, videoId: VIDEO, duration: 100 },
        ...Array.from({ length: 5 }, () => pausedAt(99.6)),
      ],
      TO_THE_END,
    );
    expect(state.index).toBe(0);
    expect(state.status).toBe("playing");
    expect(state.failures).toEqual([]);
  });

  it("still moves on from a player parked where the video actually runs out", () => {
    const { state } = run(
      [
        { kind: "start" },
        { kind: "playerState", state: PLAYER_STATE.PLAYING, currentTime: 90, videoId: VIDEO, duration: 100 },
        pausedAt(100),
      ],
      TO_THE_END,
    );
    expect(state.index).toBe(1);
  });
});

describe("the second item of a video the player could not load", () => {
  const VIDEO = "aqz-KE-bpKQ";
  const TWO_RANGES: PlaybackItem[] = [
    { id: "r1", videoId: VIDEO, startSec: 0, endSec: 10 },
    { id: "r2", videoId: VIDEO, startSec: 30, endSec: 40 },
  ];

  it("is loaded again rather than seeked inside a player that never took the video", () => {
    const failed = run(
      [{ kind: "start" }, { kind: "playerError", code: 100, videoId: VIDEO }],
      TWO_RANGES,
    );
    expect(failed.state.status).toBe("failed");

    const advanced = run(
      [{ kind: "failureAdvance", generation: failed.state.generation }],
      TWO_RANGES,
      failed.state,
    );
    expect(advanced.effects[0]).toEqual({
      kind: "load",
      index: 1,
      item: TWO_RANGES[1],
      generation: advanced.state.generation,
    });
  });
});
