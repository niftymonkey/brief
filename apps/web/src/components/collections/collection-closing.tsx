"use client";

import { useState } from "react";
import { Check, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSeconds } from "@/lib/collection-item-input";
import type { CollectionShareState } from "./collection-share-row";

interface CollectionClosingProps {
  totalRuntimeSec: number | null;
  entryCount: number;
  canPlay: boolean;
  onPlay: () => void;
  /** The share link and its state. Omitted where sharing is not the viewer's to see. */
  share?: CollectionShareState;
}

/**
 * The closing block under the reading: what the sitting adds up to, and what is
 * left to do with it.
 */
export function CollectionClosing({
  totalRuntimeSec,
  entryCount,
  canPlay,
  onPlay,
  share,
}: CollectionClosingProps) {
  const [copied, setCopied] = useState(false);

  const canShare = share !== undefined && (share.isShared || share.canManage);

  const handleShare = async () => {
    if (!share) return;
    if (share.isShared && share.shareUrl) {
      try {
        await navigator.clipboard.writeText(share.shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopied(false);
      }
      return;
    }
    share.onEnable();
  };

  const headline =
    totalRuntimeSec !== null
      ? `Total runtime of ${formatSeconds(totalRuntimeSec)}`
      : `${entryCount} ${entryCount === 1 ? "entry" : "entries"} in this collection`;

  return (
    <div className="mt-10 p-5 pb-5.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="font-heading font-semibold text-base text-[var(--color-text-primary)]">
          {headline}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)] max-w-[26rem]">
          {canShare
            ? "Plays in order. Start over from the top, or share it."
            : "Plays in order. Start over from the top."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Button
          onClick={onPlay}
          disabled={!canPlay}
          className="bg-[var(--color-accent)] !text-white hover:bg-[var(--color-accent-hover)]"
        >
          <Play className="w-4 h-4 fill-current" />
          Play from the top
        </Button>
        {canShare && (
          <Button
            variant="outline"
            onClick={handleShare}
            disabled={share.busy}
            className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-tertiary)]"
          >
            {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            {share.isShared ? (copied ? "Copied" : "Copy link") : "Share"}
          </Button>
        )}
      </div>
    </div>
  );
}
