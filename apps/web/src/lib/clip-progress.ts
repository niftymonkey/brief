// How far playback is through the clip on screen, and the feed that carries it from
// the player that reads the clock to the captions that draw it.

/** How often the player's clock is read while a clip plays: often enough to read as continuous. */
const CLIP_PROGRESS_SAMPLE_MS = 50;

/** Where playback stands inside the clip on screen, measured from the clip's own start. */
interface ClipClock {
  elapsedSec: number;
  /** The clip's length, null while it runs to the end of a video whose length is still unknown. */
  lengthSec: number | null;
}

const UNSTARTED_CLIP_CLOCK: ClipClock = { elapsedSec: 0, lengthSec: null };

/**
 * How long a clip runs. A clip with no end runs to the end of the video, and while
 * the video's length is still unknown so is the clip's.
 */
const clipLengthSec = (
  startSec: number | null,
  endSec: number | null,
  videoDurationSec: number,
): number | null => {
  const start = startSec ?? 0;
  const end = endSec ?? (videoDurationSec > 0 ? videoDurationSec : null);
  if (end === null || end <= start) return null;
  return end - start;
};

const clampWithinClip = (elapsedSec: number, lengthSec: number): number =>
  Math.min(Math.max(elapsedSec, 0), lengthSec);

/** The clip clock a playback position reads as, held between the clip's start and its end. */
const readClipClock = (
  positionSec: number,
  startSec: number | null,
  endSec: number | null,
  videoDurationSec: number,
): ClipClock => {
  const lengthSec = clipLengthSec(startSec, endSec, videoDurationSec);
  if (lengthSec === null) return UNSTARTED_CLIP_CLOCK;
  return { elapsedSec: clampWithinClip(positionSec - (startSec ?? 0), lengthSec), lengthSec };
};

/** The share of the clip the clock has covered, from 0 at its start to 1 at its end. */
const clipClockFraction = (clock: ClipClock): number =>
  clock.lengthSec === null ? 0 : clock.elapsedSec / clock.lengthSec;

/** The video position a seek to `elapsedSec` into the clip lands on, never outside the clip. */
const clipSeekTarget = (elapsedSec: number, startSec: number | null, lengthSec: number): number =>
  (startSec ?? 0) + clampWithinClip(elapsedSec, lengthSec);

/**
 * The clip progress feed. The player publishes into it, a caption reads it, and a
 * reader subscribes so that only the bar and its readout redraw on each sample,
 * never the page.
 */
interface ClipProgress {
  read: () => ClipClock;
  subscribe: (listener: () => void) => () => void;
  publish: (clock: ClipClock) => void;
}

const createClipProgress = (): ClipProgress => {
  let clock = UNSTARTED_CLIP_CLOCK;
  const listeners = new Set<() => void>();
  return {
    read: () => clock,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next) => {
      if (next.elapsedSec === clock.elapsedSec && next.lengthSec === clock.lengthSec) return;
      clock = next;
      for (const listener of [...listeners]) listener();
    },
  };
};

export {
  CLIP_PROGRESS_SAMPLE_MS,
  UNSTARTED_CLIP_CLOCK,
  clipClockFraction,
  clipLengthSec,
  clipSeekTarget,
  createClipProgress,
  readClipClock,
};
export type { ClipClock, ClipProgress };
