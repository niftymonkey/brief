"use client";

import { useState } from "react";
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
import { formatRange } from "@/lib/collection-item-input";
import type { CollectionItem } from "@/lib/collections";

interface CollectionItemRowProps {
  item: CollectionItem;
  isFirst: boolean;
  isLast: boolean;
  editable: boolean;
  reorderPending: boolean;
  onReorder: (direction: "up" | "down") => Promise<void>;
  onRemove: () => Promise<void>;
  onSummarySave: (summary: string) => Promise<void>;
  onRetrySummary: () => Promise<void>;
  onSwap: (videoId: string, startSec: number | null, endSec: number | null) => Promise<void>;
}

function thumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function watchUrl(item: CollectionItem): string {
  const base = `https://youtube.com/watch?v=${item.videoId}`;
  return item.startSec !== null ? `${base}&t=${item.startSec}s` : base;
}

export function CollectionItemRow({
  item,
  isFirst,
  isLast,
  editable,
  reorderPending,
  onReorder,
  onRemove,
  onSummarySave,
  onRetrySummary,
  onSwap,
}: CollectionItemRowProps) {
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(item.summary ?? "");
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = formatRange(item.startSec, item.endSec);
  const hasSummary = item.summary !== null && item.summary.trim().length > 0;
  const isGenerating = item.summaryStatus === "pending" && !hasSummary;
  const generationFailed = item.summaryStatus === "failed" && !hasSummary;

  const handleRetrySummary = async () => {
    setError(null);
    setIsRetrying(true);
    try {
      await onRetrySummary();
    } catch {
      setError("Could not generate a summary. Please try again.");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReorder = async (direction: "up" | "down") => {
    setError(null);
    setIsReordering(true);
    try {
      await onReorder(direction);
    } catch {
      setError("Could not reorder this item. Please try again.");
    } finally {
      setIsReordering(false);
    }
  };

  const handleRemove = async () => {
    setError(null);
    setIsRemoving(true);
    try {
      await onRemove();
    } catch {
      setError("Could not remove this item. Please try again.");
    } finally {
      setIsRemoving(false);
    }
  };

  const startEditingSummary = () => {
    setSummaryDraft(item.summary ?? "");
    setIsEditingSummary(true);
  };

  const handleSummarySave = async () => {
    setError(null);
    setIsSavingSummary(true);
    try {
      await onSummarySave(summaryDraft.trim());
      setIsEditingSummary(false);
    } catch {
      setError("Could not save the summary. Please try again.");
    } finally {
      setIsSavingSummary(false);
    }
  };

  return (
    <div className="flex gap-3 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      {editable && (
        <div className="flex flex-col gap-1 shrink-0">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => handleReorder("up")}
            disabled={isFirst || isReordering || reorderPending}
            title="Move up"
            aria-label="Move up"
          >
            <ChevronUp className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => handleReorder("down")}
            disabled={isLast || isReordering || reorderPending}
            title="Move down"
            aria-label="Move down"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
        </div>
      )}

      <a
        href={watchUrl(item)}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 w-32 aspect-video rounded-lg overflow-hidden bg-[var(--color-bg-tertiary)] relative group"
      >
        <img
          src={thumbnailUrl(item.videoId)}
          alt={item.videoTitle ?? item.videoId}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </a>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a
              href={watchUrl(item)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors line-clamp-1"
            >
              {item.videoTitle ?? item.videoId}
            </a>
            {range && (
              <p className="mt-0.5 font-mono text-xs text-[var(--color-text-tertiary)]">
                {range}
              </p>
            )}
          </div>

          {editable && (
            <div className="flex items-center gap-1 shrink-0">
              <EditItemDialog
                initialVideoId={item.videoId}
                initialStartSec={item.startSec}
                initialEndSec={item.endSec}
                onSubmit={onSwap}
              >
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
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

        <div className="mt-2">
          {isEditingSummary ? (
            <div className="space-y-2">
              <Textarea
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                placeholder="Write what matters about this clip."
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
                    "Save summary"
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
            <div className="group/summary">
              <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {item.summary}
              </p>
              {editable && (
                <button
                  type="button"
                  onClick={startEditingSummary}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                  Edit summary
                </button>
              )}
            </div>
          ) : editable && isGenerating ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating summary…
            </p>
          ) : editable && generationFailed ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--color-text-tertiary)] italic">
                Couldn&apos;t generate a summary.
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
          ) : editable ? (
            <button
              type="button"
              onClick={startEditingSummary}
              className="inline-flex items-center gap-1 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              Add a summary
            </button>
          ) : (
            <p className="text-sm text-[var(--color-text-tertiary)] italic">
              {item.summaryStatus === "failed" ? "Summary unavailable" : "No summary yet"}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
