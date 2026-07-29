import type { ReactNode } from "react";
import { Play, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CollectionSharePopover,
  type CollectionShareState,
} from "./collection-share-popover";
import { cn } from "@/lib/utils";
import { formatRuntimeWords, type CollectionSitting } from "@/lib/collection-entries";
import { describeSittingPosition, type SittingPosition } from "@/lib/collection-playback";

interface CollectionTransportProps {
  title: string;
  /** The curator's framing, which survives play rather than collapsing with the byline. */
  lede: string | null;
  curator: string | null;
  updatedLabel: string | null;
  sitting: CollectionSitting;
  canPlay: boolean;
  /** True while a run is on screen, which is what folds the header down. */
  isPlaying: boolean;
  /** Where that run stands, null until it reports its first position. */
  position: SittingPosition | null;
  onPlay: () => void;
  onStop: () => void;
  onPrev: () => void;
  onSkip: () => void;
  /** The share link and its state. Omitted where sharing is not the viewer's to see. */
  share?: CollectionShareState;
  /** Owner-only controls, joining share in the header's icon cluster. */
  actions?: ReactNode;
  /** The mounted player, which expands into the height the header gives up. */
  player?: ReactNode;
  /** The entries, or the empty state where the collection has none. */
  children: ReactNode;
}

/**
 * Collapse and expand animate `grid-template-rows` between `1fr` and `0fr`, so no
 * part of the header needs a measured height, on `--sidebar-transition`'s easing over
 * the longer span a whole layout change wants.
 */
const MOTION =
  "duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function MetaSeparator() {
  return <span className="px-1.5 opacity-50">/</span>;
}

/** A header block that gives its height to the player while a run is on screen. */
function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity]",
        MOTION,
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The collection as one section: a header that carries every control, the player it
 * folds down to make room for, and the entries under both.
 *
 * Playing does not append anything to the page, it transforms the header in place.
 * The play control shrinks and becomes stop, the title shrinks, the byline collapses
 * and the position counter takes exactly the slot it vacates, so a run costs the page
 * no height beyond the player itself and the video lands about where the title was.
 */
export function CollectionTransport({
  title,
  lede,
  curator,
  updatedLabel,
  sitting,
  canPlay,
  isPlaying,
  position,
  onPlay,
  onStop,
  onPrev,
  onSkip,
  share,
  actions,
  player,
  children,
}: CollectionTransportProps) {
  const { entries, totalRuntimeSec } = sitting;
  const playLabel =
    totalRuntimeSec !== null
      ? `Play the whole collection, ${formatRuntimeWords(totalRuntimeSec)}`
      : "Play the whole collection";

  return (
    <section className="rounded-2xl sm:rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm">
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:items-start sm:gap-4">
          <button
            type="button"
            onClick={isPlaying ? onStop : onPlay}
            disabled={!isPlaying && !canPlay}
            aria-label={isPlaying ? "Stop playback" : playLabel}
            className={cn(
              "shrink-0 inline-flex items-center justify-center rounded-full shadow-md cursor-pointer",
              "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
              "transition-[width,height,background-color]",
              MOTION,
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isPlaying ? "w-8 h-8" : "w-14 h-14",
            )}
          >
            {isPlaying ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-6 h-6 ml-0.5 fill-current" />
            )}
          </button>

          {/* On a phone the buttons take the first row together and the title drops
              to a full-width row of its own rather than into a narrow column. */}
          <div className="order-3 basis-full min-w-0 sm:order-none sm:basis-auto sm:flex-1">
            <h1
              className={cn(
                "font-heading font-semibold tracking-tight leading-[1.15] text-[var(--color-text-primary)]",
                "transition-[font-size]",
                MOTION,
                isPlaying ? "text-[1.125rem] sm:text-[1.0625rem]" : "text-[1.625rem] sm:text-[2rem]",
              )}
            >
              {title}
            </h1>

            {lede && (
              <p
                className={cn(
                  "text-[var(--color-text-secondary)] leading-[1.6] whitespace-pre-wrap sm:max-w-[36rem]",
                  "transition-[font-size,margin]",
                  MOTION,
                  isPlaying ? "mt-1 text-sm" : "mt-2 text-base",
                )}
              >
                {lede}
              </p>
            )}

            <Collapsible open={!isPlaying}>
              <p className="pt-3 font-mono text-xs text-[var(--color-text-tertiary)]">
                {curator && (
                  <>
                    <strong className="font-medium text-[var(--color-text-secondary)]">
                      {curator}
                    </strong>
                    <MetaSeparator />
                  </>
                )}
                <span>{entryCountLabel(entries.length)}</span>
                {totalRuntimeSec !== null && (
                  <>
                    <MetaSeparator />
                    <span>{formatRuntimeWords(totalRuntimeSec)}</span>
                  </>
                )}
                {updatedLabel && (
                  <>
                    <MetaSeparator />
                    <span>updated {updatedLabel}</span>
                  </>
                )}
              </p>
            </Collapsible>

            {/* Takes the slot the byline vacates, so playing adds no header height. */}
            <Collapsible open={isPlaying}>
              {/* The slot keeps its height before the run reports its first
                  position, so the collapse animates to one settled height. */}
              <p className="pt-2 min-h-6 font-mono text-xs text-[var(--color-text-tertiary)]">
                {position && describeSittingPosition(position)}
              </p>
            </Collapsible>
          </div>

          {/* One cluster for transport and ownership alike, sized here so every
              control in it matches whichever component contributed it. */}
          <div className="ml-auto shrink-0 flex items-center gap-1.5 sm:ml-0 sm:gap-2 [&_button]:size-8.5 sm:[&_button]:size-9">
            {isPlaying && (
              <>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={onPrev}
                  title="Previous entry"
                  aria-label="Previous entry"
                  className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
                >
                  <SkipBack className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={onSkip}
                  title="Next entry"
                  aria-label="Next entry"
                  className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
                {/* The divider only earns its place between two groups, and a
                    reader's cluster has nothing on the far side of it. */}
                {(share || actions) && (
                  <span
                    aria-hidden="true"
                    className="w-px h-6 mx-0.5 bg-[var(--color-border)]"
                  />
                )}
              </>
            )}
            {share && <CollectionSharePopover share={share} />}
            {actions}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows]",
          MOTION,
          isPlaying ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "px-4 pt-3.5 sm:px-6 sm:pt-4 transition-[opacity,transform]",
              MOTION,
              isPlaying ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
            )}
          >
            {player}
          </div>
        </div>
      </div>

      <div className="mx-4 sm:mx-6 mt-5 h-px bg-[var(--color-border)]" />
      <div className="px-4 sm:px-6 pb-3 sm:pb-4">{children}</div>
    </section>
  );
}
