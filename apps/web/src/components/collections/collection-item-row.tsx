"use client";

import { useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
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
      className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3.5 py-7.5 min-[621px]:grid-cols-[4.25rem_minmax(0,1fr)] min-[621px]:gap-6 min-[621px]:py-9 border-b border-[var(--color-border)] last:border-b-0 scroll-mt-20"
    >
      <div className="flex flex-col items-start pt-0.5">
        <span
          className={cn(
            "font-heading text-xl min-[621px]:text-2xl font-light leading-[1.2] tabular-nums",
            isActive
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-text-tertiary)]",
          )}
        >
          {String(entry.ordinal).padStart(2, "0")}
        </span>
        {entry.offsetSec !== null && (
          <span className="mt-[0.3125rem] font-mono text-[0.625rem] min-[621px]:text-[0.6875rem] whitespace-nowrap text-[var(--color-text-tertiary)]">
            at {formatSeconds(entry.offsetSec)}
          </span>
        )}
        {!isLast && (
          <span
            aria-hidden="true"
            className="block w-px grow min-h-6 mt-2.5 ml-[0.55rem] bg-[var(--color-border)]"
          />
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <h3 className="basis-full min-[621px]:basis-auto min-[621px]:grow min-w-0 font-heading text-xl min-[621px]:text-[1.375rem] font-semibold leading-[1.3] tracking-tight text-[var(--color-text-primary)]">
            <a
              href={entry.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-accent)] transition-colors"
            >
              {entry.title}
            </a>
          </h3>

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

        <div className="flex flex-wrap items-center gap-2 mt-2 font-mono text-xs text-[var(--color-text-tertiary)]">
          <span className="inline-flex items-center px-1.5 py-px rounded-sm bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] text-[0.6875rem] tracking-[0.02em]">
            {entry.kindLabel}
          </span>
          {entry.channelName && (
            <>
              <span>{entry.channelName}</span>
              <span className="opacity-50">/</span>
            </>
          )}
          <span>{entry.rangeLabel}</span>
          {entry.durationSec !== null && (
            <>
              <span className="opacity-50">/</span>
              <span>{formatSeconds(entry.durationSec)}</span>
            </>
          )}
        </div>

        <div className="mt-4.5">
          {/* The heading link above already names this entry and points at the same
              video, so this one is a pointing device only and stays out of the
              accessibility tree and the tab order. */}
          <a
            href={entry.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-hidden="true"
            tabIndex={-1}
            style={thumbnailStyle}
            className={cn(
              "group relative block float-none mb-3.5 min-[621px]:float-right min-[621px]:mt-1 min-[621px]:mb-3 min-[621px]:ml-6 aspect-[var(--thumb-aspect)] rounded-lg overflow-hidden bg-[var(--color-bg-tertiary)]",
              isVerticalThumbnail
                ? // Sized from a capped height so a vertical entry's row stands about
                  // as tall as a landscape one beside the same amount of text.
                  "w-[calc(10rem*var(--thumb-aspect))] min-[621px]:w-[calc(7.5rem*var(--thumb-aspect))]"
                : "w-full max-w-[14rem] min-[621px]:w-34",
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
              <p className="text-base min-[621px]:text-[1.0625rem] leading-[1.7] text-[var(--color-text-secondary)] whitespace-pre-wrap">
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

          <a
            href={entry.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Watch ${entry.title}`}
            className="clear-both inline-flex items-center gap-1.5 mt-4.5 text-sm font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            Watch this entry
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
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
