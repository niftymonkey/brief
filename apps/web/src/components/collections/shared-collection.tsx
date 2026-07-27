"use client";

import { useCallback, useState } from "react";
import { CollectionClosing } from "@/components/collections/collection-closing";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import {
  CollectionPlayer,
  type ActiveSitting,
} from "@/components/collections/collection-player";
import { CollectionTransport } from "@/components/collections/collection-transport";
import {
  buildSitting,
  resolveActiveEntryId,
  type EntryVideoFacts,
} from "@/lib/collection-entries";
import type { CollectionWithItems } from "@/lib/collections";

interface SharedCollectionProps {
  collection: CollectionWithItems;
  /** What the curator's own briefs know about each video, keyed by video id. */
  videoFacts: Record<string, EntryVideoFacts>;
  /** Server-formatted last-updated date, so the byline never mismatches on hydration. */
  updatedLabel: string | null;
}

/**
 * A shared collection as a reader who is not its curator sees it: the same
 * transport hero, entries and closing block the curator's own page renders, with
 * every owner control and the share row absent rather than disabled.
 *
 * It holds only the state the play seam needs, so there is nothing here that
 * could change the collection even if a reader reached it.
 */
export function SharedCollection({
  collection,
  videoFacts,
  updatedLabel,
}: SharedCollectionProps) {
  const [activeSitting, setActiveSitting] = useState<ActiveSitting | null>(null);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);

  const items = collection.items;

  const handlePlayingItemChange = useCallback((itemId: string | null) => {
    setPlayingItemId(itemId);
  }, []);

  /** Opens a run of the collection from the top, which is also what restarts one. */
  const startSitting = useCallback(() => {
    setPlayingItemId(null);
    setActiveSitting((previous) => ({ key: (previous?.key ?? 0) + 1, items: [...items] }));
  }, [items]);

  const closePlayer = useCallback(() => {
    setActiveSitting(null);
    setPlayingItemId(null);
  }, []);

  const sitting = buildSitting(items, videoFacts);
  const entryCount = sitting.entries.length;
  const canPlay = entryCount > 0;
  const activeEntryId = resolveActiveEntryId(sitting.entries, playingItemId);

  return (
    <div>
      <CollectionTransport
        title={collection.title}
        lede={collection.description}
        curator={null}
        updatedLabel={updatedLabel}
        sitting={sitting}
        canPlay={canPlay}
        activeEntryId={activeEntryId}
        onPlay={startSitting}
      />

      {activeSitting && activeSitting.items.length > 0 && (
        <CollectionPlayer
          key={activeSitting.key}
          items={activeSitting.items}
          onClose={closePlayer}
          onCurrentItemChange={handlePlayingItemChange}
        />
      )}

      <div className="flex items-baseline justify-between gap-4 mt-11 mb-2 pb-1.5 border-b border-[var(--color-border)]">
        <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
          {entryCount === 0
            ? "no entries yet"
            : `${entryCount} ${entryCount === 1 ? "entry" : "entries"}, read or watch in order`}
        </span>
      </div>

      {entryCount === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--color-text-secondary)]">No entries yet</p>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
            The curator hasn&apos;t added anything to this collection.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {sitting.entries.map((entry, index) => (
            <CollectionItemRow
              key={entry.id}
              item={items[index]}
              entry={entry}
              isFirst={index === 0}
              isLast={index === entryCount - 1}
              isActive={entry.id === activeEntryId}
            />
          ))}
        </div>
      )}

      {entryCount > 0 && (
        <CollectionClosing
          totalRuntimeSec={sitting.totalRuntimeSec}
          entryCount={entryCount}
          canPlay={canPlay}
          onPlay={startSitting}
        />
      )}
    </div>
  );
}
