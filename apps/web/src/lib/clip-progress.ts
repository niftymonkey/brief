// How far playback is through the clip on screen, and the feed that carries it from
// the player that reads the clock to the captions that draw it.

/** How often the player's clock is read while a clip plays: often enough to read as continuous. */
const CLIP_PROGRESS_SAMPLE_MS = 50;

/**
 * The share of the clip's own range a playback position has covered, from 0 at its
 * start to 1 at its end. A clip with no end runs to the end of the video, and while
 * the video's length is still unknown the clip reads as not yet started.
 */
const clipProgressFraction = (
  positionSec: number,
  startSec: number | null,
  endSec: number | null,
  videoDurationSec: number,
): number => {
  const start = startSec ?? 0;
  const end = endSec ?? videoDurationSec;
  if (end <= start) return 0;
  return Math.min(Math.max((positionSec - start) / (end - start), 0), 1);
};

/**
 * The clip progress feed. The player publishes into it, a caption reads it, and a
 * reader subscribes so that only the bar redraws on each sample, never the page.
 */
interface ClipProgress {
  read: () => number;
  subscribe: (listener: () => void) => () => void;
  publish: (fraction: number) => void;
}

const createClipProgress = (): ClipProgress => {
  let fraction = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => fraction,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next) => {
      if (next === fraction) return;
      fraction = next;
      for (const listener of [...listeners]) listener();
    },
  };
};

export { CLIP_PROGRESS_SAMPLE_MS, clipProgressFraction, createClipProgress };
export type { ClipProgress };
