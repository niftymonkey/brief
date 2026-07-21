"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddItemForm } from "@/components/collections/add-item-form";
import { CollectionItemRow } from "@/components/collections/collection-item-row";
import { DeleteCollectionButton } from "@/components/collections/delete-collection-button";
import { EditCollectionDialog } from "@/components/collections/edit-collection-dialog";
import { reorderNeighbors } from "@/lib/collection-item-input";
import { notifyCollectionsChanged } from "@/lib/collections-events";
import type { CollectionItem, CollectionWithItems } from "@/lib/collections";

interface CollectionDetailProps {
  collection: CollectionWithItems;
  editable: boolean;
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

export function CollectionDetail({ collection, editable }: CollectionDetailProps) {
  const router = useRouter();
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description);
  const [items, setItems] = useState<CollectionItem[]>(sortByPosition(collection.items));
  const [reorderPending, setReorderPending] = useState(false);

  const collectionId = collection.id;

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
      // Leave the row 'pending'; a retry affordance on the row handles recovery.
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
    // Client-driven async summary: the row renders 'pending' immediately, then
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
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-xl md:text-2xl font-semibold text-[var(--color-text-primary)]">
          {title}
        </h1>
        {editable && (
          <div className="flex items-center gap-2 shrink-0">
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
          </div>
        )}
      </div>

      {description && (
        <p className="text-[var(--color-text-secondary)] mb-4 whitespace-pre-wrap">
          {description}
        </p>
      )}

      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        {items.length} {items.length === 1 ? "item" : "items"}
      </p>

      {editable && (
        <div className="mb-6">
          <AddItemForm onAdd={handleAddItem} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--color-text-secondary)]">No items yet</p>
          {editable && (
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
              Paste a YouTube URL above to add the first clip.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <CollectionItemRow
              key={item.id}
              item={item}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              editable={editable}
              reorderPending={reorderPending}
              onReorder={(direction) => handleReorder(index, direction)}
              onRemove={() => handleRemove(item.id)}
              onSummarySave={(summary) => handleSummarySave(item.id, summary)}
              onRetrySummary={() => summarizeItem(item.id)}
              onSwap={(videoId, startSec, endSec) =>
                handleSwap(item.id, videoId, startSec, endSec)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
