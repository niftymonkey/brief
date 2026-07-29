"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddItemForm } from "@/components/collections/add-item-form";
import { CollectionClosing } from "@/components/collections/collection-closing";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import {
  CollectionPlayer,
  type ActiveSitting,
  type CollectionPlayerHandle,
} from "@/components/collections/collection-player";
import { CollectionTransport } from "@/components/collections/collection-transport";
import { DeleteCollectionButton } from "@/components/collections/delete-collection-button";
import { EditCollectionDialog } from "@/components/collections/edit-collection-dialog";
import { SortableItemRow } from "@/components/collections/sortable-item-row";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { neighborsOf, reorderById } from "@/lib/collection-item-input";
import {
  buildSitting,
  resolveActiveEntryId,
  type EntryVideoFacts,
} from "@/lib/collection-entries";
import type { SittingPosition } from "@/lib/collection-playback";
import { notifyCollectionsChanged } from "@/lib/collections-events";
import type { CollectionShareState } from "@/components/collections/collection-share-popover";
import type { CollectionItem, CollectionWithItems } from "@/lib/collections";

interface CollectionDetailProps {
  collection: CollectionWithItems;
  editable: boolean;
  /** What the viewer's briefs know about each video, keyed by video id. */
  videoFacts: Record<string, EntryVideoFacts>;
  /** The curator named on the control surface. */
  curator: string | null;
  /** Server-formatted last-updated date, so the byline never mismatches on hydration. */
  updatedLabel: string | null;
  /** Absolute origin the share link is built from. */
  siteOrigin: string;
}

function sortByPosition(items: CollectionItem[]): CollectionItem[] {
  return [...items].sort((a, b) => a.position - b.position);
}

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function CollectionDetail({
  collection,
  editable,
  videoFacts,
  curator,
  updatedLabel,
  siteOrigin,
}: CollectionDetailProps) {
  const router = useRouter();
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description);
  const [items, setItems] = useState<CollectionItem[]>(sortByPosition(collection.items));
  const [reorderPending, setReorderPending] = useState(false);
  const [isShared, setIsShared] = useState(collection.isShared);
  const [slug, setSlug] = useState(collection.slug);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [activeSitting, setActiveSitting] = useState<ActiveSitting | null>(null);
  const [position, setPosition] = useState<SittingPosition | null>(null);
  /** The run on screen, for the prev and skip controls the header carries for it. */
  const playerRef = useRef<CollectionPlayerHandle>(null);

  // A grip has to travel a few pixels before it counts as a drag, so a plain
  // click on it (or a tap that turns into a page scroll) never lifts a row. The
  // keyboard sensor is what keeps reordering reachable without a pointer: focus
  // the grip, space to lift, arrows to move, space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collectionId = collection.id;

  const handlePositionChange = useCallback((next: SittingPosition | null) => {
    setPosition(next);
  }, []);

  /** Opens a run of the collection, from the top, on the entries as they stand now. */
  const startSitting = useCallback(() => {
    setPosition(null);
    setActiveSitting((previous) => ({ key: (previous?.key ?? 0) + 1, items: [...items] }));
  }, [items]);

  const closePlayer = useCallback(() => {
    setActiveSitting(null);
    setPosition(null);
  }, []);

  const handleEditCollection = async (nextTitle: string, nextDescription: string | null) => {
    const updated = await requestJson<{ title: string; description: string | null }>(
      `/api/collections/${collectionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, description: nextDescription }),
      },
    );
    setTitle(updated.title);
    setDescription(updated.description);
    notifyCollectionsChanged();
    router.refresh();
  };

  const summarizeItem = async (itemId: string) => {
    try {
      const updated = await requestJson<CollectionItem>(
        `/api/collections/${collectionId}/items/${itemId}/summarize`,
        { method: "POST" },
      );
      setItems((prev) =>
        sortByPosition(prev.map((item) => (item.id === updated.id ? updated : item))),
      );
    } catch {
      // Leave the entry 'pending'; a retry affordance on the entry handles recovery.
    }
  };

  const handleAddItem = async (
    videoId: string,
    startSec: number | null,
    endSec: number | null,
  ) => {
    const item = await requestJson<CollectionItem>(
      `/api/collections/${collectionId}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          startSec: startSec ?? undefined,
          endSec: endSec ?? undefined,
        }),
      },
    );
    setItems((prev) => sortByPosition([...prev, item]));
    notifyCollectionsChanged();
    router.refresh();
    // Client-driven async summary: the entry renders 'pending' immediately, then
    // updates in place when generation resolves. Fire-and-forget so the add
    // returns without blocking on the LLM call.
    if (item.summaryStatus !== "ready") {
      void summarizeItem(item.id);
    }
  };

  /**
   * Settles a drag. The list is reordered locally first so the entry stays where
   * it was dropped, then the server is told its new neighbours and answers with
   * the position it computed. A failed write puts the order the user was looking
   * at before the drag back, rather than leaving the page showing a move that
   * did not happen.
   */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const previous = items;
    const settledIds = reorderById(
      items.map((item) => item.id),
      String(active.id),
      String(over.id),
    );
    const neighbors = neighborsOf(settledIds, String(active.id));
    if (!neighbors) return;

    setItems(
      settledIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is CollectionItem => item !== undefined),
    );
    setReorderPending(true);
    try {
      const updated = await requestJson<CollectionItem>(
        `/api/collections/${collectionId}/items/${String(active.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(neighbors),
        },
      );
      setItems((prev) =>
        sortByPosition(prev.map((item) => (item.id === updated.id ? updated : item))),
      );
    } catch {
      setItems(previous);
    } finally {
      setReorderPending(false);
    }
  };

  const handleRemove = async (itemId: string) => {
    await requestJson<{ success: true }>(
      `/api/collections/${collectionId}/items/${itemId}`,
      { method: "DELETE" },
    );
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    notifyCollectionsChanged();
    router.refresh();
  };

  const handleSummarySave = async (itemId: string, summary: string) => {
    const updated = await requestJson<CollectionItem>(
      `/api/collections/${collectionId}/items/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      },
    );
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleSwap = async (
    itemId: string,
    videoId: string,
    startSec: number | null,
    endSec: number | null,
  ) => {
    const updated = await requestJson<CollectionItem>(
      `/api/collections/${collectionId}/items/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, startSec, endSec }),
      },
    );
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    // The hero reads the new video's title, channel and length off the server's
    // videoFacts prop, which only a refresh can restock.
    router.refresh();
  };

  const setSharing = async (nextShared: boolean) => {
    setShareError(null);
    setShareBusy(true);
    try {
      const updated = await requestJson<{ isShared: boolean; slug: string | null }>(
        `/api/collections/${collectionId}/share`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isShared: nextShared }),
        },
      );
      setIsShared(updated.isShared);
      setSlug(updated.slug);
      router.refresh();
    } catch {
      setShareError(
        nextShared ? "Could not create a share link." : "Could not stop sharing.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  /**
   * The sitting the player is mounted on, which is the active one for exactly as long
   * as the collection under it still holds entries. Reading the live list here, rather
   * than the run's own frozen copy, is what takes the player off screen the moment the
   * collection empties, however many removals were in flight when it happened. Letting
   * go of the sitting in the same breath is what keeps a later add from putting the
   * finished run back on screen over a collection the curator has just refilled.
   */
  const openSitting = activeSitting !== null && items.length > 0 ? activeSitting : null;
  if (activeSitting !== null && openSitting === null) {
    setActiveSitting(null);
    setPosition(null);
  }

  const sitting = buildSitting(items, videoFacts);
  const entryCount = sitting.entries.length;
  const canPlay = entryCount > 0;
  const activeEntryId = resolveActiveEntryId(sitting.entries, position?.itemId ?? null);
  const share: CollectionShareState = {
    isShared,
    shareUrl: slug ? `${siteOrigin}/c/${slug}` : null,
    canManage: editable,
    busy: shareBusy,
    error: shareError,
    onEnable: () => void setSharing(true),
    onDisable: () => void setSharing(false),
  };

  return (
    <div>
      <CollectionTransport
        title={title}
        lede={description}
        curator={curator}
        updatedLabel={updatedLabel}
        sitting={sitting}
        canPlay={canPlay}
        isPlaying={openSitting !== null}
        position={position}
        onPlay={startSitting}
        onStop={closePlayer}
        onPrev={() => playerRef.current?.prev()}
        onSkip={() => playerRef.current?.skip()}
        share={share}
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
        actions={
          editable ? (
            <>
              <EditCollectionDialog
                initialTitle={title}
                initialDescription={description}
                onSave={handleEditCollection}
              >
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
                  title="Edit collection"
                  aria-label="Edit collection"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </EditCollectionDialog>
              <DeleteCollectionButton collectionId={collectionId} title={title} />
            </>
          ) : undefined
        }
      >
        {entryCount === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--color-text-secondary)]">No entries yet</p>
            {editable && (
              <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                Paste a YouTube URL below to add the first entry.
              </p>
            )}
          </div>
        ) : editable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col">
                {sitting.entries.map((entry, index) => (
                  <SortableItemRow
                    key={entry.id}
                    item={items[index]}
                    entry={entry}
                    isLast={index === entryCount - 1}
                    isActive={entry.id === activeEntryId}
                    dragDisabled={reorderPending}
                    controls={{
                      onRemove: () => handleRemove(entry.id),
                      onSummarySave: (summary) => handleSummarySave(entry.id, summary),
                      onRetrySummary: () => summarizeItem(entry.id),
                      onSwap: (videoId, startSec, endSec) =>
                        handleSwap(entry.id, videoId, startSec, endSec),
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex flex-col">
            {sitting.entries.map((entry, index) => (
              <CollectionItemRow
                key={entry.id}
                item={items[index]}
                entry={entry}
                isLast={index === entryCount - 1}
                isActive={entry.id === activeEntryId}
              />
            ))}
          </div>
        )}
      </CollectionTransport>

      {editable && (
        <div className="mt-8">
          <AddItemForm onAdd={handleAddItem} />
        </div>
      )}

      {entryCount > 0 && (
        <CollectionClosing
          totalRuntimeSec={sitting.totalRuntimeSec}
          entryCount={entryCount}
          canPlay={canPlay}
          onPlay={startSitting}
          share={share}
        />
      )}
    </div>
  );
}
