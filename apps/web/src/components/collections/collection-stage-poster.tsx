"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  entryAspectRatio,
  entryPosterSources,
  isVerticalAspectRatio,
  playAllLabel,
  playCollectionLabel,
  type CollectionEntry,
  type CollectionSitting,
} from "@/lib/collection-entries";

interface CollectionStagePosterProps {
  /** The collection, for the count and runtime the Play control names. */
  sitting: CollectionSitting;
  /** The entry Play starts from, or null when there is none to show. */
  entry: CollectionEntry | null;
  canPlay: boolean;
  onPlay: () => void;
  /**
   * The stage's sizing for the box. Give it the same classes as the player's frame:
   * both publish the entry's shape as `--frame-aspect`, so the same rule draws both
   * at the same size and pressing Play moves nothing.
   */
  className?: string;
}

/**
 * The shape the poster is drawn at, published to the CSS so the stage can size the
 * box from it exactly as it sizes the player's frame.
 */
interface PosterStyle extends CSSProperties {
  "--frame-aspect": string;
}

/** YouTube answers a still size it does not have with a placeholder this wide. */
const PLACEHOLDER_WIDTH = 120;

/**
 * The cued entry's still, drawn in the stage where its video will play, with the
 * collection's Play over it.
 *
 * Every poster source is a landscape still, pillarboxed for a vertical video, so the
 * box is drawn at the video's own shape and the still covers it from the centre:
 * the blurred panels fall outside the box and the real frame fills it. The slight
 * overscale hides the half-pixel seam a pillarbox can leave at the crop line.
 */
export function CollectionStagePoster({
  sitting,
  entry,
  canPlay,
  onPlay,
  className,
}: CollectionStagePosterProps) {
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([]);

  // Held as the urls that failed rather than a step count, so cueing a different
  // entry starts from its own largest still without a remount.
  const sources = entry ? entryPosterSources(entry.videoId) : [];
  const src = sources.find((url) => !failedUrls.includes(url)) ?? null;

  const markFailed = useCallback((url: string) => {
    setFailedUrls((failed) => (failed.includes(url) ? failed : [...failed, url]));
  }, []);

  // A still that settled before the page hydrated fired its load or error event
  // before React was listening, so the image is read once as it mounts.
  const readSettledImage = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || !image.complete) return;
      const settledSrc = image.getAttribute("src");
      if (settledSrc !== null && image.naturalWidth <= PLACEHOLDER_WIDTH) {
        markFailed(settledSrc);
      }
    },
    [markFailed],
  );

  const aspect = entryAspectRatio(entry?.aspectRatio ?? null);
  const posterStyle: PosterStyle = { "--frame-aspect": String(aspect) };
  const { entries, totalRuntimeSec } = sitting;

  return (
    <div
      style={posterStyle}
      data-frame-shape={isVerticalAspectRatio(entry?.aspectRatio ?? null) ? "vertical" : "landscape"}
      className={cn(
        "relative overflow-hidden bg-black aspect-[var(--frame-aspect)] rounded-xl",
        className,
      )}
    >
      {/* Lazy, because a browser does not fetch a lazy image that has no box, and
          the stage has none below a wide screen. */}
      {src !== null && (
        <img
          ref={readSettledImage}
          src={src}
          alt=""
          loading="lazy"
          onError={() => markFailed(src)}
          onLoad={(event) => {
            if (event.currentTarget.naturalWidth <= PLACEHOLDER_WIDTH) markFailed(src);
          }}
          className="absolute inset-0 size-full object-cover object-center scale-[1.01]"
        />
      )}
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <button
          type="button"
          onClick={onPlay}
          disabled={!canPlay}
          aria-label={playCollectionLabel(totalRuntimeSec)}
          className={cn(
            "inline-flex items-center justify-center size-16 rounded-full shadow-md cursor-pointer",
            "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors",
            // Terracotta on terracotta would hide the ring, so it is white on a black
            // offset, which reads over any still.
            "outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <Play className="size-7 ml-0.5 fill-current" />
        </button>
        {/* Nearly opaque, because a Short's burned-in subtitles sit right where it does. */}
        <span className="rounded-full bg-black/85 px-3 py-1.5 font-mono text-xs text-white/90">
          {playAllLabel(entries.length, totalRuntimeSec)}
        </span>
      </div>
    </div>
  );
}
