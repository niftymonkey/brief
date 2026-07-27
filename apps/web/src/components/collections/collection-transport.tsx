import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { CollectionShareRow, type CollectionShareState } from "./collection-share-row";
import { CollectionTrack } from "./collection-track";
import { formatRuntimeWords, type CollectionSitting } from "@/lib/collection-entries";

interface CollectionTransportProps {
  title: string;
  /** The curator's framing, given lede weight on the control surface itself. */
  lede: string | null;
  curator: string | null;
  updatedLabel: string | null;
  sitting: CollectionSitting;
  canPlay: boolean;
  activeEntryId: string | null;
  onPlay: () => void;
  share: CollectionShareState;
  /** Owner-only controls, sitting opposite the heading. */
  actions?: ReactNode;
}

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * The transport hero: one play control for the whole sitting, its total runtime,
 * a proportional track of the entries, and the share link, all above the reading.
 */
export function CollectionTransport({
  title,
  lede,
  curator,
  updatedLabel,
  sitting,
  canPlay,
  activeEntryId,
  onPlay,
  share,
  actions,
}: CollectionTransportProps) {
  const { entries, totalRuntimeSec, runtimeComplete } = sitting;
  const runtimeLead =
    totalRuntimeSec !== null ? formatRuntimeWords(totalRuntimeSec) : entryCountLabel(entries.length);

  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-sm p-5 min-[721px]:p-7">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0 min-[721px]:flex-nowrap min-[721px]:items-start min-[721px]:gap-5">
        <button
          type="button"
          onClick={onPlay}
          disabled={!canPlay}
          aria-label={
            totalRuntimeSec !== null
              ? `Play the whole collection, ${formatRuntimeWords(totalRuntimeSec)}`
              : "Play the whole collection"
          }
          className="shrink-0 w-12 h-12 min-[721px]:w-15 min-[721px]:h-15 rounded-full bg-[var(--color-accent)] text-white inline-flex items-center justify-center shadow-md transition-[background-color,transform] hover:bg-[var(--color-accent-hover)] hover:scale-105 cursor-pointer disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
        >
          <Play className="w-5 h-5 min-[721px]:w-6 min-[721px]:h-6 ml-0.5 fill-current" />
        </button>

        <div className="contents min-[721px]:block min-[721px]:flex-1 min-[721px]:min-w-0">
          <div className="grow basis-0 min-w-0">
            <div className="font-mono text-[0.6875rem] tracking-[0.12em] uppercase text-[var(--color-accent)] mb-2">
              Play through
            </div>
            <h1 className="font-heading font-semibold tracking-tight leading-[1.15] text-[1.625rem] min-[721px]:text-[2rem] text-[var(--color-text-primary)]">
              {title}
            </h1>
          </div>

          {lede && (
            <p className="basis-full mt-4.5 min-[721px]:mt-3.5 text-base min-[721px]:text-[1.0625rem] leading-[1.7] text-[var(--color-text-secondary)] min-[721px]:max-w-[34rem] whitespace-pre-wrap">
              {lede}
            </p>
          )}

          <div className="basis-full flex flex-wrap items-center gap-2.5 mt-4 text-sm text-[var(--color-text-tertiary)]">
            {curator && (
              <>
                <strong className="font-semibold text-[var(--color-text-secondary)]">
                  {curator}
                </strong>
                <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60" />
              </>
            )}
            <span>curated in this order</span>
            {updatedLabel && (
              <>
                <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60" />
                <span>updated {updatedLabel}</span>
              </>
            )}
          </div>
        </div>

        {actions && (
          <div className="basis-full min-[721px]:basis-auto shrink-0 flex items-center gap-2 mt-4 min-[721px]:mt-0">
            {actions}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-6 font-mono text-xs text-[var(--color-text-tertiary)]">
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
          {runtimeLead}
        </span>
        {totalRuntimeSec !== null && (
          <>
            <span className="opacity-50">/</span>
            <span>{entryCountLabel(entries.length)}</span>
          </>
        )}
        {entries.length > 0 && (
          <span className="basis-full min-[721px]:basis-auto">
            <span className="hidden min-[721px]:inline opacity-50">/ </span>
            plays straight through, in order
          </span>
        )}
      </div>

      {runtimeComplete && totalRuntimeSec !== null && (
        <CollectionTrack
          entries={entries}
          totalRuntimeSec={totalRuntimeSec}
          activeEntryId={activeEntryId}
        />
      )}

      <CollectionShareRow share={share} />
    </section>
  );
}
