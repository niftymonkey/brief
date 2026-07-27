"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddItemForm } from "@/components/collections/add-item-form";
import { CollectionClosing } from "@/components/collections/collection-closing";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import { CollectionPlayerSlot } from "@/components/collections/collection-player-slot";
import { CollectionTransport } from "@/components/collections/collection-transport";
import { DeleteCollectionButton } from "@/components/collections/delete-collection-button";
import { EditCollectionDialog } from "@/components/collections/edit-collection-dialog";
import { reorderNeighbors } from "@/lib/collection-item-input";
import {
  buildSitting,
  resolveActiveEntryId,
  type EntryVideoFacts,
} from "@/lib/collection-entries";
import { notifyCollectionsChanged } from "@/lib/collections-events";
import type { CollectionShareState } from "@/components/collections/collection-share-row";
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
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);

  const collectionId = collection.id;

  const handlePlayingItemChange = useCallback((itemId: string | null) => {
    setPlayingItemId(itemId);
  }, []);

  const closePlayer = useCallback(() => {
    setPlayerOpen(false);
    setPlayingItemId(null);
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

  const handleReorder = async (index: number, direction: "up" | "down") => {
    const neighbors = reorderNeighbors(
      items.map((item) => item.id),
      index,
      direction,
    );
    if (!neighbors) return;

    const moved = items[index];
    setReorderPending(true);
    try {
      const updated = await requestJson<CollectionItem>(
        `/api/collections/${collectionId}/items/${moved.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(neighbors),
        },
      );
      setItems((prev) =>
        sortByPosition(prev.map((item) => (item.id === updated.id ? updated : item))),
      );
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

  const sitting = buildSitting(items, videoFacts);
  const entryCount = sitting.entries.length;
  const canPlay = entryCount > 0;
  const activeEntryId = resolveActiveEntryId(sitting.entries, playingItemId);
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
        activeEntryId={activeEntryId}
        onPlay={() => setPlayerOpen(true)}
        share={share}
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
      />

      {playerOpen && items.length > 0 && (
        <CollectionPlayerSlot
          items={items}
          onClose={closePlayer}
          onPlayingItemChange={handlePlayingItemChange}
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
          {editable && (
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              Paste a YouTube URL below to add the first entry.
            </p>
          )}
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
              editable={editable}
              reorderPending={reorderPending}
              onReorder={(direction) => handleReorder(index, direction)}
              onRemove={() => handleRemove(entry.id)}
              onSummarySave={(summary) => handleSummarySave(entry.id, summary)}
              onRetrySummary={() => summarizeItem(entry.id)}
              onSwap={(videoId, startSec, endSec) =>
                handleSwap(entry.id, videoId, startSec, endSec)
              }
            />
          ))}
        </div>
      )}

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
          onPlay={() => setPlayerOpen(true)}
          share={share}
        />
      )}
    </div>
  );
}
