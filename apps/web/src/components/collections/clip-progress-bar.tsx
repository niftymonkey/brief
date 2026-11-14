// The thin bar that shows how far playback is through the clip on screen, and the
// readout of the same clock in minutes and seconds.

import {
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { clipClockFraction, type ClipClock, type ClipProgress } from "@/lib/clip-progress";
import { formatSeconds } from "@/lib/collection-item-input";
import { cn } from "@/lib/utils";

/** How far one arrow key moves playback, in seconds. */
const SEEK_NUDGE_SEC = 5;

/** Moves playback to this many seconds into the clip; the player keeps it inside the clip. */
type SeekWithinClip = (elapsedSec: number) => void;

const useClipClock = (progress: ClipProgress): ClipClock =>
  useSyncExternalStore(progress.subscribe, progress.read, progress.read);

/** Seconds into the clip under the pointer, read off where it sits along the bar. */
const elapsedUnderPointer = (event: PointerEvent<HTMLElement>, lengthSec: number): number => {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width <= 0) return 0;
  return ((event.clientX - box.left) / box.width) * lengthSec;
};

/** Where a key moves playback to, or null for a key the bar does not answer. */
const elapsedForKey = (key: string, clock: ClipClock, lengthSec: number): number | null => {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clock.elapsedSec - SEEK_NUDGE_SEC;
    case "ArrowRight":
    case "ArrowUp":
      return clock.elapsedSec + SEEK_NUDGE_SEC;
    case "Home":
      return 0;
    case "End":
      return lengthSec;
    default:
      return null;
  }
};

interface ClipProgressMeterProps {
  progress: ClipProgress;
  onSeek: SeekWithinClip;
  className?: string;
}

/**
 * The bar, kept current from the feed the player publishes into, and a slider that
 * moves playback within the clip by press, drag or arrow key. A caller keys it by
 * the entry on screen, so a drag ends when the run moves to another clip rather
 * than seeking inside the next one.
 */
const ClipProgressMeter = ({ progress, onSeek, className }: ClipProgressMeterProps) => {
  const clock = useClipClock(progress);
  const isDraggingRef = useRef(false);
  const lengthSec = clock.lengthSec ?? 0;
  const canSeek = clock.lengthSec !== null;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!canSeek || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    onSeek(elapsedUnderPointer(event, lengthSec));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    onSeek(elapsedUnderPointer(event, lengthSec));
  };

  const endDrag = () => {
    isDraggingRef.current = false;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    const target = elapsedForKey(event.key, clock, lengthSec);
    if (target === null) return;
    event.preventDefault();
    onSeek(target);
  };

  return (
    <div
      role="slider"
      tabIndex={canSeek ? 0 : -1}
      aria-label="Clip progress"
      aria-valuemin={0}
      aria-valuemax={Math.round(lengthSec)}
      aria-valuenow={Math.round(clock.elapsedSec)}
      aria-valuetext={`${formatSeconds(clock.elapsedSec)} of ${formatSeconds(lengthSec)}`}
      aria-disabled={canSeek ? undefined : true}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      // The track is a hairline, so the slider's own box is taller than it and
      // takes the press for it.
      className={cn(
        "group/seek flex items-center h-3 touch-none rounded-full outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        canSeek && "cursor-pointer",
        className,
      )}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)] transition-[height] group-hover/seek:h-1.5">
        <div
          className="h-full w-full origin-left rounded-full bg-[var(--color-playing)]"
          style={{ transform: `scaleX(${clipClockFraction(clock)})` }}
        />
      </div>
    </div>
  );
};

interface ClipClockReadoutProps {
  progress: ClipProgress;
  className?: string;
}

/** Time into the clip over the clip's length, "0:13 / 0:47", kept current from the feed. */
const ClipClockReadout = ({ progress, className }: ClipClockReadoutProps) => {
  const clock = useClipClock(progress);
  if (clock.lengthSec === null) return null;
  return (
    <span className={cn("shrink-0 tabular-nums", className)}>
      {formatSeconds(clock.elapsedSec)} / {formatSeconds(clock.lengthSec)}
    </span>
  );
};

export { ClipClockReadout, ClipProgressMeter };
export type { SeekWithinClip };
