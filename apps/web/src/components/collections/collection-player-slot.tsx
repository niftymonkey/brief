"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CollectionPlayerItem {
  id: string;
  videoId: string;
  videoTitle: string | null;
  summary: string | null;
  startSec: number | null;
  endSec: number | null;
}

interface CollectionPlayerSlotProps {
  items: CollectionPlayerItem[];
  onClose: () => void;
  /**
   * Reports the id of the item the slot is on, or null when it is on none. The
   * page reads it back as an entry id, which holds because the sitting carries
   * each item's id through onto its entry.
   */
  onPlayingItemChange: (itemId: string | null) => void;
}

/**
 * The seam the continuous player mounts into. It takes the exact props the player
 * takes: the items to play, a close callback, and a report of which item is
 * current, which the page uses to light the entry and its segment of the track.
 *
 * Until the player itself lands, the slot stands on the first item for as long as
 * it is open, which is what its own copy claims, and reports that through the same
 * callback the player will use.
 */
export function CollectionPlayerSlot({
  items,
  onClose,
  onPlayingItemChange,
}: CollectionPlayerSlotProps) {
  const playingItemId = items[0]?.id ?? null;

  useEffect(() => {
    onPlayingItemChange(playingItemId);
    return () => onPlayingItemChange(null);
  }, [playingItemId, onPlayingItemChange]);

  return (
    <div className="mt-4 p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-heading font-semibold text-sm text-[var(--color-text-primary)]">
          Playing {items.length} {items.length === 1 ? "entry" : "entries"} in order
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          The player mounts here.
        </p>
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onClose}
        title="Close the player"
        aria-label="Close the player"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
