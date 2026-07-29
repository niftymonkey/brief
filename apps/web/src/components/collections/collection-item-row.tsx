"use client";

import { useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditItemDialog } from "@/components/collections/edit-item-dialog";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/collection-item-input";
import { entryAspectRatio, isVerticalAspectRatio } from "@/lib/collection-entries";
import type { CollectionEntry } from "@/lib/collection-entries";
import type { CollectionItem } from "@/lib/collections";

/**
 * Everything a curator can do to one entry. Held as a single object so a row
 * rendered without it has no way to reach a mutation at all, rather than relying
 * on a flag to keep the controls hidden.
 */
export interface CollectionItemRowControls {
  /** True while any entry in the collection is mid-reorder. */
  reorderPending: boolean;
  onReorder: (direction: "up" | "down") => Promise<void>;
  onRemove: () => Promise<void>;
  onSummarySave: (summary: string) => Promise<void>;
  onRetrySummary: () => Promise<void>;
  onSwap: (videoId: string, startSec: number | null, endSec: number | null) => Promise<void>;
}

interface CollectionItemRowProps {
  item: CollectionItem;
  /** The same item read as one entry of the sitting: its place, title and links. */
  entry: CollectionEntry;
  isFirst: boolean;
  isLast: boolean;
  /** True while the player is on this entry, so the list says where the sitting is. */
  isActive: boolean;
  /** The curator's controls. Omitted for a reader, whose entry is strictly read-only. */
  controls?: CollectionItemRowControls;
}

const controlClass =
  "text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]";

/**
 * The thumbnail's shape, published to the CSS as well, because a vertical
 * thumbnail is sized from a capped height and its width is derived from this.
 */
interface ThumbnailStyle extends CSSProperties {
  "--thumb-aspect": string;
}

/**
 * One entry of the collection: the ordinal column with its start position, the
 * entry's own title, a mono source line, and the curator's note as body copy with
 * the thumbnail subordinate to it.
 */
export function CollectionItemRow({
  item,
  entry,
  isFirst,
  isLast,
  isActive,
  controls,
}: CollectionItemRowProps) {
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(item.summary ?? "");
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedThumbnailUrls, setFailedThumbnailUrls] = useState<readonly string[]>([]);

  // Held as the urls that failed rather than a flag, so swapping the entry to a
  // different video shows its thumbnail again without a remount.
  const thumbnailSrc =
    [entry.thumbnailUrl, entry.thumbnailFallbackUrl].find(
      (url): url is string => url !== null && !failedThumbnailUrls.includes(url),
    ) ?? null;

  const thumbnailAspect = entryAspectRatio(entry.aspectRatio);
  const isVerticalThumbnail = isVerticalAspectRatio(entry.aspectRatio);
  const thumbnailStyle: ThumbnailStyle = { "--thumb-aspect": String(thumbnailAspect) };

  // What the mono slot says when this row is not the one playing: where the
  // entry starts in its source video, and how long it runs.
  const restingLabel = [
    entry.offsetSec !== null ? `at ${formatSeconds(entry.offsetSec)}` : null,
    entry.durationSec !== null ? formatSeconds(entry.durationSec) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" / ");

  const hasSummary = item.summary !== null && item.summary.trim().length > 0;
  const isGenerating = item.summaryStatus === "pending" && !hasSummary;
  const generationFailed = item.summaryStatus === "failed" && !hasSummary;

  const handleRetrySummary = async () => {
    if (!controls) return;
    setError(null);
    setIsRetrying(true);
    try {
      await controls.onRetrySummary();
    } catch {
      setError("Could not generate a note. Please try again.");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReorder = async (direction: "up" | "down") => {
    if (!controls) return;
    setError(null);
    setIsReordering(true);
    try {
      await controls.onReorder(direction);
    } catch {
      setError("Could not reorder this entry. Please try again.");
    } finally {
      setIsReordering(false);
    }
  };

  const handleRemove = async () => {
    if (!controls) return;
    setError(null);
    setIsRemoving(true);
    try {
      await controls.onRemove();
    } catch {
      setError("Could not remove this entry. Please try again.");
    } finally {
      setIsRemoving(false);
    }
  };

  const startEditingSummary = () => {
    setSummaryDraft(item.summary ?? "");
    setIsEditingSummary(true);
  };

  const handleSummarySave = async () => {
    if (!controls) return;
    setError(null);
    setIsSavingSummary(true);
    try {
      await controls.onSummarySave(summaryDraft.trim());
      setIsEditingSummary(false);
    } catch {
      setError("Could not save the note. Please try again.");
    } finally {
      setIsSavingSummary(false);
    }
  };

  return (
    <section
      id={entry.anchorId}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "relative grid grid-cols-1 gap-3.5 py-4",
        "sm:grid-cols-[3.25rem_minmax(0,1fr)] sm:gap-4 sm:py-5",
        "scroll-mt-20",
      )}
    >
      {/* A phone has no ordinal column, so the rail cannot mark the sitting there.
          This is the same mark in the only place a phone has room for it. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="sm:hidden absolute -left-2 top-1 bottom-1 w-0.5 rounded-full bg-[var(--color-playing)]"
        />
      )}

      {/* The ordinal column is the first thing a phone gives up: the list is short
          enough to read in order without it, and the width buys the title a line. */}
      <div className="relative hidden sm:flex flex-col items-start">
        {/* One rail down the whole list rather than a border per row. It runs
            through the row's padding into its neighbours, and the marker's own
            background is what breaks it, so the seam never lands on a boundary.
            The first and last rows stop it at their marker's centre. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-[0.875rem] w-px -top-5 -bottom-5 transition-colors duration-300",
            isActive ? "bg-[var(--color-playing)]" : "bg-[var(--color-border)]",
            isFirst && "top-3.5",
            isLast && "bottom-[calc(100%-0.875rem)]",
          )}
        />
        <span
          className={cn(
            "relative flex items-center justify-center size-7 rounded-full border",
            "font-mono text-[0.6875rem] tabular-nums transition-colors duration-300",
            isActive
              ? "border-[var(--color-playing)] bg-[var(--color-playing)] text-[var(--color-bg-secondary)]"
              : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)]",
          )}
        >
          {String(entry.ordinal).padStart(2, "0")}
        </span>
      </div>

      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h3 className="basis-full sm:basis-auto sm:grow min-w-0 font-heading text-base sm:text-[1.0625rem] font-semibold leading-[1.35] tracking-tight text-[var(--color-text-primary)]">
            <a
              href={entry.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-accent)] transition-colors"
            >
              {entry.title}
            </a>
          </h3>

          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className={cn(
                "font-mono text-xs whitespace-nowrap",
                isActive
                  ? // The lit rail already says which row is playing, so at phone
                    // width the words go rather than crush the title.
                    "hidden sm:inline text-[var(--color-playing)]"
                  : "text-[var(--color-text-tertiary)]",
              )}
            >
              {isActive ? "now playing" : restingLabel}
            </span>

            {controls && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => handleReorder("up")}
                disabled={isFirst || isReordering || controls.reorderPending}
                className={controlClass}
                title="Move up"
                aria-label="Move up"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => handleReorder("down")}
                disabled={isLast || isReordering || controls.reorderPending}
                className={controlClass}
                title="Move down"
                aria-label="Move down"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
              <EditItemDialog
                initialVideoId={item.videoId}
                initialStartSec={item.startSec}
                initialEndSec={item.endSec}
                onSubmit={controls.onSwap}
              >
                <Button
                  variant="outline"
                  size="icon-sm"
                  className={controlClass}
                  title="Replace video or range"
                  aria-label="Replace video or range"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </EditItemDialog>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={handleRemove}
                disabled={isRemoving}
                className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-red-500 hover:border-red-500/50 hover:bg-[var(--color-bg-tertiary)]"
                title="Remove from collection"
                aria-label="Remove from collection"
              >
                {isRemoving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
              </div>
            )}
          </div>
        </div>

        {/* `flow-root` contains the thumbnail's float, so a note shorter than the
            still cannot let it escape the row. */}
        <div className="flow-root mt-2.5">
          {/* A fixed-width slot with the still centred inside it, so a 9:16 entry and
              a 16:9 entry both leave the note wrapping at the same x. */}
          <span
            style={thumbnailStyle}
            className="block float-right w-19 mb-2 ml-4 sm:w-26 sm:ml-5"
          >
            {/* The heading link above already names this entry and points at the same
                video, so this one is a pointing device only and stays out of the
                accessibility tree and the tab order. */}
            <a
              href={entry.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-hidden="true"
              tabIndex={-1}
              className={cn(
                "group relative block mx-auto aspect-[var(--thumb-aspect)] rounded-md sm:rounded-lg overflow-hidden bg-[var(--color-bg-tertiary)]",
                isVerticalThumbnail
                  ? // Sized from a capped height so a vertical entry's still stands
                    // about as tall as the landscape one filling the same slot.
                    "w-[calc(3.5rem*var(--thumb-aspect))] sm:w-[calc(4.75rem*var(--thumb-aspect))]"
                  : "w-full",
              )}
            >
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[0.625rem] tracking-[0.04em] text-[var(--color-text-tertiary)]">
                {entry.videoId}
              </span>
              {thumbnailSrc !== null && (
                <img
                  src={thumbnailSrc}
                  alt=""
                  loading="lazy"
                  onError={() => setFailedThumbnailUrls((failed) => [...failed, thumbnailSrc])}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              )}
            </a>
          </span>

          {isEditingSummary ? (
            <div className="space-y-2">
              <Textarea
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                placeholder="Write what matters about this entry."
                rows={3}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSummarySave} disabled={isSavingSummary}>
                  {isSavingSummary ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save note"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditingSummary(false)}
                  disabled={isSavingSummary}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : hasSummary ? (
            <div>
              <p className="text-sm sm:text-[0.9375rem] leading-[1.55] text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {item.summary}
              </p>
              {controls && (
                <button
                  type="button"
                  onClick={startEditingSummary}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                  Edit note
                </button>
              )}
            </div>
          ) : controls && isGenerating ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Writing a note...
            </p>
          ) : controls && generationFailed ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--color-text-tertiary)] italic">
                Couldn&apos;t write a note.
              </span>
              <button
                type="button"
                onClick={handleRetrySummary}
                disabled={isRetrying}
                className="inline-flex items-center gap-1 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {isRetrying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCw className="w-3.5 h-3.5" />
                )}
                Retry
              </button>
              <button
                type="button"
                onClick={startEditingSummary}
                className="inline-flex items-center gap-1 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                Write one
              </button>
            </div>
          ) : controls ? (
            <button
              type="button"
              onClick={startEditingSummary}
              className="inline-flex items-center gap-1 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              Add a note
            </button>
          ) : (
            <p className="text-sm text-[var(--color-text-tertiary)] italic">
              {item.summaryStatus === "failed" ? "Note unavailable" : "No note yet"}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
