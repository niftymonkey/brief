"use client";

import { useCallback, useRef, useState } from "react";
import { CollectionClosing } from "@/components/collections/collection-closing";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import {
  CollectionPlayer,
  type ActiveSitting,
  type CollectionPlayerHandle,
} from "@/components/collections/collection-player";
import { CollectionTransport } from "@/components/collections/collection-transport";
import {
  buildSitting,
  resolveActiveEntryId,
  type EntryVideoFacts,
} from "@/lib/collection-entries";
import type { SittingPosition } from "@/lib/collection-playback";
import type { CollectionWithItems } from "@/lib/collections";

interface SharedCollectionProps {
  collection: CollectionWithItems;
  /** What the curator's own briefs know about each video, keyed by video id. */
  videoFacts: Record<string, EntryVideoFacts>;
  /** Server-formatted last-updated date, so the byline never mismatches on hydration. */
  updatedLabel: string | null;
}

/**
 * A shared collection as a reader who is not its curator sees it: the same one
 * section the curator's own page renders, header, player and entries alike, with
 * every owner control and the share popover absent rather than disabled.
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
  const [position, setPosition] = useState<SittingPosition | null>(null);
  /** The run on screen, for the prev and skip controls the header carries for it. */
  const playerRef = useRef<CollectionPlayerHandle>(null);

  const items = collection.items;

  const handlePositionChange = useCallback((next: SittingPosition | null) => {
    setPosition(next);
  }, []);

  /** Opens a run of the collection from the top, which is also what restarts one. */
  const startSitting = useCallback(() => {
    setPosition(null);
    setActiveSitting((previous) => ({ key: (previous?.key ?? 0) + 1, items: [...items] }));
  }, [items]);

  const closePlayer = useCallback(() => {
    setActiveSitting(null);
    setPosition(null);
  }, []);

  const sitting = buildSitting(items, videoFacts);
  const entryCount = sitting.entries.length;
  const canPlay = entryCount > 0;
  const activeEntryId = resolveActiveEntryId(sitting.entries, position?.itemId ?? null);
  const openSitting = activeSitting !== null && activeSitting.items.length > 0 ? activeSitting : null;

  return (
    <div>
      <CollectionTransport
        title={collection.title}
        lede={collection.description}
        curator={null}
        updatedLabel={updatedLabel}
        sitting={sitting}
        canPlay={canPlay}
        isPlaying={openSitting !== null}
        position={position}
        onPlay={startSitting}
        onStop={closePlayer}
        onPrev={() => playerRef.current?.prev()}
        onSkip={() => playerRef.current?.skip()}
        player={
          openSitting && (
            <CollectionPlayer
              key={openSitting.key}
              ref={playerRef}
              items={openSitting.items}
              onPositionChange={handlePositionChange}
            />
          )
        }
      >
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
      </CollectionTransport>

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
