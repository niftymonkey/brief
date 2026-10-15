"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import {
  CollectionPlayer,
  type ActiveSitting,
  type CollectionPlayerHandle,
} from "@/components/collections/collection-player";
import {
  CollectionTransport,
  useFullscreenToggles,
} from "@/components/collections/collection-transport";
import {
  buildSitting,
  cueAt,
  resolveActiveEntryId,
  resolveCuedIndex,
  type EntryCue,
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
  /** Pinned to the foot of the shelf on a wide screen. */
  shelfFooter?: ReactNode;
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
  shelfFooter,
}: SharedCollectionProps) {
  const [activeSitting, setActiveSitting] = useState<ActiveSitting | null>(null);
  const [position, setPosition] = useState<SittingPosition | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** The entry a wide screen's stage shows while nothing plays, and Play starts from. */
  const [cue, setCue] = useState<EntryCue>({ entryId: null, index: 0 });
  /** The run on screen, for the prev, skip, jump and full screen controls the page carries for it. */
  const playerRef = useRef<CollectionPlayerHandle>(null);
  const fullscreenToggles = useFullscreenToggles();

  const items = collection.items;

  const handlePositionChange = useCallback((next: SittingPosition | null) => {
    setPosition(next);
  }, []);

  /** Opens a run of the collection on one entry, which is also what restarts one. */
  const startSitting = useCallback(
    (startIndex: number) => {
      setPosition(null);
      setCue(cueAt(items, startIndex));
      setActiveSitting((previous) => ({
        key: (previous?.key ?? 0) + 1,
        items: [...items],
        startIndex,
      }));
    },
    [items],
  );

  const sitting = buildSitting(items, videoFacts);
  const entryCount = sitting.entries.length;
  const canPlay = entryCount > 0;
  const activeEntryId = resolveActiveEntryId(sitting.entries, position?.itemId ?? null);
  const openSitting = activeSitting !== null && activeSitting.items.length > 0 ? activeSitting : null;
  const cued = resolveCuedIndex(sitting.entries, cue);

  /** Stops the run and cues the entry it was on, so Play picks up there. */
  const closePlayer = () => {
    const onScreen = sitting.entries.findIndex((entry) => entry.id === position?.itemId);
    if (onScreen >= 0) setCue(cueAt(sitting.entries, onScreen));
    else if (position?.isDone) setCue(cueAt(sitting.entries, 0));
    setActiveSitting(null);
    setPosition(null);
  };

  /** Puts an entry on the stage: the run moves there, or it becomes the cued one. */
  const jumpTo = (index: number) => {
    const entry = sitting.entries[index];
    if (!entry) return;
    if (openSitting === null) {
      setCue(cueAt(sitting.entries, index));
      return;
    }
    if (!playerRef.current?.jumpTo(entry.id)) startSitting(index);
  };

  return (
    <CollectionTransport
      title={collection.title}
      lede={collection.description}
      curator={null}
      updatedLabel={updatedLabel}
      sitting={sitting}
      notes={items.map((item) => item.summary)}
      canPlay={canPlay}
      isPlaying={openSitting !== null}
      position={position}
      cuedIndex={cued}
      isFullscreen={isFullscreen}
      onPlay={startSitting}
      onStop={closePlayer}
      onPrev={() => playerRef.current?.prev()}
      onSkip={() => playerRef.current?.skip()}
      onToggleFullscreen={() => playerRef.current?.toggleFullscreen()}
      fullscreenToggles={fullscreenToggles}
      player={
        openSitting && (
          <CollectionPlayer
            key={openSitting.key}
            ref={playerRef}
            items={openSitting.items}
            startIndex={openSitting.startIndex}
            onPositionChange={handlePositionChange}
            onFullscreenChange={setIsFullscreen}
            fullscreenReturnFocusRef={fullscreenToggles.returnFocus}
          />
        )
      }
      shelfFooter={shelfFooter}
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
              isLast={index === entryCount - 1}
              isActive={entry.id === activeEntryId}
              isCued={openSitting === null && index === cued}
              onJump={() => jumpTo(index)}
            />
          ))}
        </div>
      )}
    </CollectionTransport>
  );
}
