// The thin bar that shows how far playback is through the clip on screen.

import { useSyncExternalStore } from "react";
import type { ClipProgress } from "@/lib/clip-progress";
import { cn } from "@/lib/utils";

interface ClipProgressBarProps {
  /** Share of the clip covered, from 0 to 1. */
  fraction: number;
  className?: string;
}

const ClipProgressBar = ({ fraction, className }: ClipProgressBarProps) => (
  <div
    role="progressbar"
    aria-label="Clip progress"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(fraction * 100)}
    className={cn("h-1 overflow-hidden rounded-full bg-[var(--color-border)]", className)}
  >
    <div
      className="h-full w-full origin-left rounded-full bg-[var(--color-playing)]"
      style={{ transform: `scaleX(${fraction})` }}
    />
  </div>
);

interface ClipProgressMeterProps {
  progress: ClipProgress;
  className?: string;
}

/** The bar, kept current from the feed the player publishes into. */
const ClipProgressMeter = ({ progress, className }: ClipProgressMeterProps) => {
  const fraction = useSyncExternalStore(progress.subscribe, progress.read, progress.read);
  return <ClipProgressBar fraction={fraction} className={className} />;
};

export { ClipProgressMeter };
