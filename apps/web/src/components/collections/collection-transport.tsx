import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Maximize, Minimize, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CollectionSharePopover,
  type CollectionShareState,
} from "./collection-share-popover";
import {
  STAGE_FIELD_CLASS,
  STAGE_FIELD_MEASURE_CLASS,
  STAGE_FRAME_CLASS,
} from "./collection-player";
import { CollectionStagePoster } from "./collection-stage-poster";
import { cn } from "@/lib/utils";
import {
  formatRuntimeWords,
  playCollectionLabel,
  type CollectionSitting,
} from "@/lib/collection-entries";
import {
  describeSittingPosition,
  readSittingSteps,
  type SittingPosition,
} from "@/lib/collection-playback";

/**
 * The page's two full screen toggles, the header's and the stage's, of which a given
 * width draws exactly one, and the one of them focus goes back to when the frame
 * leaves full screen.
 */
export interface FullscreenToggles {
  header: RefObject<HTMLButtonElement | null>;
  stage: RefObject<HTMLButtonElement | null>;
  returnFocus: RefObject<HTMLElement | null>;
}

/** Whether the element has a box on screen, which a `display: none` one does not. */
function isDrawn(element: HTMLElement | null): element is HTMLElement {
  return element !== null && element.getClientRects().length > 0;
}

/**
 * Refs for the full screen toggles. Which of them is drawn is the CSS's call and can
 * change with a resize at any moment, so the return target is read at the moment
 * focus goes back rather than settled when a toggle mounts.
 */
export function useFullscreenToggles(): FullscreenToggles {
  const header = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLButtonElement>(null);
  const [returnFocus] = useState<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return isDrawn(stage.current) ? stage.current : header.current;
    },
  }));
  return { header, stage, returnFocus };
}

interface CollectionTransportProps {
  title: string;
  /** The curator's framing, which survives play rather than collapsing with the byline. */
  lede: string | null;
  curator: string | null;
  updatedLabel: string | null;
  sitting: CollectionSitting;
  /** Each entry's note, in the sitting's order, for the caption under the stage. */
  notes: readonly (string | null)[];
  canPlay: boolean;
  /** True while a run is on screen, which is what folds the header down. */
  isPlaying: boolean;
  /** Where that run stands, null until it reports its first position. */
  position: SittingPosition | null;
  /** The entry the stage shows while nothing plays, which its Play starts from. */
  cuedIndex: number;
  /** True while the player fills the screen. */
  isFullscreen: boolean;
  /** Starts a run on the entry at this index of the sitting. */
  onPlay: (startIndex: number) => void;
  onStop: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onToggleFullscreen: () => void;
  /** The full screen toggles themselves, for the player to hand focus back to. */
  fullscreenToggles?: FullscreenToggles;
  /** The share link and its state. Omitted where sharing is not the viewer's to see. */
  share?: CollectionShareState;
  /** Owner-only controls, joining share in the header's icon cluster. */
  actions?: ReactNode;
  /** The mounted player, which expands into the height the header gives up. */
  player?: ReactNode;
  /** Pinned to the foot of the shelf on a wide screen, and right after the section below one. */
  shelfFooter?: ReactNode;
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

const QUIET_ICON_BUTTON =
  "text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]";

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/** A place in the sitting set the way the rail's markers set an ordinal: "02 of 05". */
function ordinalPlace(place: number, total: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(place)} of ${pad(total)}`;
}

function MetaSeparator() {
  return <span className="px-1.5 opacity-50">/</span>;
}

/** A header block that gives its height to the player while a run is on screen. */
function Collapsible({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity]",
        MOTION,
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

interface StageCaptionProps {
  sitting: CollectionSitting;
  notes: readonly (string | null)[];
  isPlaying: boolean;
  position: SittingPosition | null;
  cuedIndex: number;
  onStop: () => void;
  onPrev: () => void;
  onSkip: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  fullscreenToggleRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * The wide screen's caption under the stage: where the entry on screen sits in the
 * collection, its title and its note, with the run's transport on the right while
 * one plays. It holds one height whatever the entry's text runs to, so a skip never
 * moves the stage above it.
 */
function StageCaption({
  sitting,
  notes,
  isPlaying,
  position,
  cuedIndex,
  onStop,
  onPrev,
  onSkip,
  isFullscreen,
  onToggleFullscreen,
  fullscreenToggleRef,
}: StageCaptionProps) {
  const { entries } = sitting;
  const { canStepBack, canStepForward } = readSittingSteps(position);
  const isDone = isPlaying && position?.isDone === true;
  const isLive = isPlaying && position?.ordinal != null;
  // Before the run reports its first entry it is opening on the cued one.
  const index =
    isLive && position?.itemId
      ? entries.findIndex((entry) => entry.id === position.itemId)
      : cuedIndex;
  const entry = isDone ? null : (entries[index] ?? null);
  const note = isDone ? null : (notes[index] ?? null);

  return (
    // Rows pack to the top, and the title holds the lines it may take, so the note
    // starts at the same place for every entry. Below `xl` the stage is narrow enough
    // that the title gets a second line. The stage sets the height and the width,
    // which is the field's, so the caption lines up under it.
    <div className="hidden lg:grid shrink-0 lg:h-[var(--stage-caption-h)] lg:w-[var(--stage-field-w)] content-start grid-cols-[minmax(0,1fr)_auto] gap-x-6 px-1">
      <div className="min-w-0">
        <p className="font-mono text-xs leading-[1.4] text-[var(--color-text-tertiary)]">
          {isLive && position ? (
            <>
              <span className="text-[var(--color-playing)]">now playing</span>
              <MetaSeparator />
              <span>{ordinalPlace(position.ordinal ?? 1, position.total)}</span>
            </>
          ) : isDone && position ? (
            <span>{ordinalPlace(position.total, position.total)}</span>
          ) : (
            entry && <span>{ordinalPlace(index + 1, entries.length)}</span>
          )}
        </p>
        <p className="mt-1 h-[2.7em] line-clamp-2 xl:h-auto xl:line-clamp-1 font-heading text-[1.125rem] font-semibold leading-[1.35] tracking-tight text-[var(--color-text-primary)]">
          {isDone ? "Playback complete." : (entry?.title ?? "")}
        </p>
      </div>

      {isPlaying && (
        <div className="flex items-center gap-2 self-start [&_button]:size-9">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onPrev}
            disabled={!canStepBack}
            title="Previous entry"
            aria-label="Previous entry"
            className={QUIET_ICON_BUTTON}
          >
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onSkip}
            disabled={!canStepForward}
            title="Next entry"
            aria-label="Next entry"
            className={QUIET_ICON_BUTTON}
          >
            <SkipForward className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onStop}
            title="Stop playback"
            aria-label="Stop playback"
            className={QUIET_ICON_BUTTON}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </Button>
          <Button
            ref={fullscreenToggleRef}
            variant="outline"
            size="icon-sm"
            onClick={onToggleFullscreen}
            title={isFullscreen ? "Exit full screen" : "Enter full screen"}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            className={QUIET_ICON_BUTTON}
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </Button>
        </div>
      )}

      <p className="col-span-2 mt-2 line-clamp-4 text-[0.9375rem] leading-[1.55] text-[var(--color-text-secondary)]">
        {note ?? ""}
      </p>
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
 *
 * A wide screen lays the same tree out side by side: the section dissolves into a
 * grid of the viewport's height, with the player's slot as the stage on the left and
 * the header, the entries and the shelf footer stacked in a shelf on the right whose
 * rail scrolls on its own. Nothing is rendered twice for the two layouts except what
 * only one of them draws, so the player never remounts across the breakpoint.
 */
export function CollectionTransport({
  title,
  lede,
  curator,
  updatedLabel,
  sitting,
  notes,
  canPlay,
  isPlaying,
  position,
  cuedIndex,
  isFullscreen,
  onPlay,
  onStop,
  onPrev,
  onSkip,
  onToggleFullscreen,
  fullscreenToggles,
  share,
  actions,
  player,
  shelfFooter,
  children,
}: CollectionTransportProps) {
  const { entries, totalRuntimeSec } = sitting;
  const { canStepBack, canStepForward } = readSittingSteps(position);
  const playLabel = playCollectionLabel(totalRuntimeSec);

  return (
    <div className="lg:flex-1 lg:min-h-0 lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] xl:grid-cols-[minmax(0,1fr)_27rem] 2xl:grid-cols-[minmax(0,1fr)_31rem] lg:grid-rows-[auto_auto_minmax(0,1fr)_auto] lg:gap-x-6">
      <section className="rounded-2xl sm:rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm lg:contents">
        {/* The section's own box is gone on a wide screen, so the shelf it becomes
            is drawn behind the head, the rail and the footer as one surface. */}
        <div
          aria-hidden="true"
          className="hidden lg:block lg:col-start-2 lg:row-[1/-1] rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm"
        />

        <div className="px-4 pt-4 sm:px-6 sm:pt-6 lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:items-start sm:gap-4">
            {/* A wide screen plays and stops from the stage instead. */}
            <button
              type="button"
              onClick={isPlaying ? onStop : () => onPlay(0)}
              disabled={!isPlaying && !canPlay}
              aria-label={isPlaying ? "Stop playback" : playLabel}
              className={cn(
                "shrink-0 inline-flex items-center justify-center rounded-full shadow-md cursor-pointer",
                "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
                "transition-[width,height,background-color]",
                MOTION,
                "disabled:opacity-50 disabled:cursor-not-allowed",
                isPlaying ? "w-8 h-8" : "w-14 h-14",
                "lg:hidden",
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
                  "lg:text-[1.5rem]",
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
                    "lg:mt-1.5 lg:text-[0.9375rem]/[1.6]",
                  )}
                >
                  {lede}
                </p>
              )}

              {/* The stage below a wide screen's shelf has room for the run's place,
                  so the shelf keeps the byline throughout. */}
              <Collapsible open={!isPlaying} className="lg:grid-rows-[1fr] lg:opacity-100">
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
              <Collapsible open={isPlaying} className="lg:hidden">
                {/* The slot keeps its height before the run reports its first
                    position, so the collapse animates to one settled height. */}
                <p className="pt-2 min-h-6 font-mono text-xs text-[var(--color-text-tertiary)]">
                  {position && describeSittingPosition(position)}
                </p>
              </Collapsible>
            </div>

            {/* One cluster for transport and ownership alike, sized here so every
                control in it matches whichever component contributed it. A wide
                screen carries the transport under the stage instead. */}
            <div className="ml-auto shrink-0 flex items-center gap-1.5 sm:ml-0 sm:gap-2 [&_button]:size-8.5 sm:[&_button]:size-9">
              {isPlaying && (
                <>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={onPrev}
                    disabled={!canStepBack}
                    title="Previous entry"
                    aria-label="Previous entry"
                    className={cn(QUIET_ICON_BUTTON, "lg:hidden")}
                  >
                    <SkipBack className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={onSkip}
                    disabled={!canStepForward}
                    title="Next entry"
                    aria-label="Next entry"
                    className={cn(QUIET_ICON_BUTTON, "lg:hidden")}
                  >
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  <Button
                    ref={fullscreenToggles?.header}
                    variant="outline"
                    size="icon-sm"
                    onClick={onToggleFullscreen}
                    title={isFullscreen ? "Exit full screen" : "Enter full screen"}
                    aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                    className={cn(QUIET_ICON_BUTTON, "lg:hidden")}
                  >
                    {isFullscreen ? (
                      <Minimize className="w-4 h-4" />
                    ) : (
                      <Maximize className="w-4 h-4" />
                    )}
                  </Button>
                  {/* The divider only earns its place between two groups, and a
                      reader's cluster has nothing on the far side of it. */}
                  {(share || actions) && (
                    <span
                      aria-hidden="true"
                      className="w-px h-6 mx-0.5 bg-[var(--color-border)] lg:hidden"
                    />
                  )}
                </>
              )}
              {share && <CollectionSharePopover share={share} />}
              {actions}
            </div>
          </div>
        </div>

        {/* The stage on a wide screen: the dark field the video or the cued entry's
            poster sits in, and the caption under it. The column measures itself so
            the field can be a 16:9 box as wide as the column, or as tall as the
            height left above the caption when that runs out first. A landscape video
            fills it exactly and only a narrower one is barred at the sides. The field
            and the caption pack to the top, centred, so spare height falls below the
            caption. Full screen drops the measuring for the reason the field does. */}
        <div
          data-collection-stage
          className={cn(
            "grid transition-[grid-template-rows]",
            MOTION,
            isPlaying ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            "lg:col-start-1 lg:row-[1/-1] lg:flex lg:flex-col lg:items-center lg:gap-4 lg:min-h-0",
            "lg:[--stage-caption-h:10.75rem] xl:[--stage-caption-h:9.25rem]",
            "lg:[--stage-field-h:min(100cqw*9/16,100cqh_-_var(--stage-caption-h)_-_1rem)] lg:[--stage-field-w:calc(var(--stage-field-h)*16/9)]",
            !isFullscreen && "lg:[container-type:size]",
          )}
        >
          <div className="min-h-0 overflow-hidden lg:flex lg:flex-none lg:flex-col lg:w-[var(--stage-field-w)] lg:h-[var(--stage-field-h)]">
            {/* Any translate, even a zero one, would make this the box a filled
                player is fixed to instead of the viewport, so full screen drops it,
                and a wide screen, which never slides the player in, has none. */}
            <div
              className={cn(
                "px-4 pt-3.5 sm:px-6 sm:pt-4 transition-[opacity,transform]",
                MOTION,
                isPlaying ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2",
                isFullscreen && "translate-none",
                "lg:flex lg:flex-1 lg:flex-col lg:min-h-0 lg:p-0 lg:opacity-100 lg:translate-none lg:transition-none",
              )}
            >
              {player}
              {!isPlaying && (
                <div className={cn("hidden", STAGE_FIELD_CLASS, STAGE_FIELD_MEASURE_CLASS)}>
                  <CollectionStagePoster
                    sitting={sitting}
                    entry={entries[cuedIndex] ?? null}
                    canPlay={canPlay}
                    onPlay={() => onPlay(cuedIndex)}
                    className={STAGE_FRAME_CLASS}
                  />
                </div>
              )}
            </div>
          </div>

          <StageCaption
            sitting={sitting}
            notes={notes}
            isPlaying={isPlaying}
            position={position}
            cuedIndex={cuedIndex}
            onStop={onStop}
            onPrev={onPrev}
            onSkip={onSkip}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            fullscreenToggleRef={fullscreenToggles?.stage}
          />
        </div>

        <div className="mx-4 sm:mx-6 mt-5 h-px bg-[var(--color-border)] lg:col-start-2 lg:row-start-2" />
        {/* On a wide screen the rail fades out over its last few pixels, so a row
            cut off at the shelf's foot reads as more below rather than as clipped. */}
        <div className="px-4 sm:px-6 pb-3 sm:pb-4 lg:col-start-2 lg:row-start-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:mx-1 lg:px-5 lg:pb-2 lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]">
          {children}
        </div>
      </section>

      {shelfFooter && (
        <div className="lg:col-start-2 lg:row-start-4 lg:mx-6 lg:border-t lg:border-[var(--color-border)] lg:pt-4 lg:pb-5">
          {shelfFooter}
        </div>
      )}
    </div>
  );
}
