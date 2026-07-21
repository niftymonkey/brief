"use client";

import { useMemo, useState } from "react";
import { Check, FolderPlus, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { deriveChapterScopes } from "@/lib/brief-collection-scope";
import { formatRange } from "@/lib/collection-item-input";
import { notifyCollectionsChanged } from "@/lib/collections-events";
import type { Collection } from "@/lib/collections";
import type { ContentSection } from "@/lib/types";

interface AddToCollectionButtonProps {
  videoId: string;
  sections: ContentSection[];
}

const WHOLE_VIDEO = "video";
const NEW_COLLECTION = "__new__";

export function AddToCollectionButton({ videoId, sections }: AddToCollectionButtonProps) {
  const chapterScopes = useMemo(() => deriveChapterScopes(sections), [sections]);

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>(WHOLE_VIDEO);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setScope(WHOLE_VIDEO);
    setDestination(null);
    setNewTitle("");
    setNewDescription("");
    setError(null);
  };

  const loadCollections = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/collections");
      if (!response.ok) {
        setError("Could not load your collections. Please try again.");
        return;
      }
      const data: Collection[] = await response.json();
      setCollections(data);
    } catch {
      setError("Could not load your collections. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (isSubmitting) return;
    setOpen(next);
    if (next) {
      reset();
      loadCollections();
    }
  };

  const scopeToRange = (): { startSec: number | null; endSec: number | null } => {
    if (scope === WHOLE_VIDEO) return { startSec: null, endSec: null };
    const chapter = chapterScopes[Number(scope)];
    if (!chapter) return { startSec: null, endSec: null };
    return { startSec: chapter.startSec, endSec: chapter.endSec };
  };

  const canSubmit =
    !isSubmitting &&
    (destination === NEW_COLLECTION
      ? newTitle.trim().length > 0
      : destination !== null);

  const addItem = async (collectionId: string) => {
    const { startSec, endSec } = scopeToRange();
    const body: { videoId: string; startSec?: number; endSec?: number } = { videoId };
    if (startSec !== null) body.startSec = startSec;
    if (endSec !== null) body.endSec = endSec;

    const response = await fetch(`/api/collections/${collectionId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      let collectionId = destination;

      if (destination === NEW_COLLECTION) {
        const response = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newTitle.trim(),
            description: newDescription.trim() || undefined,
          }),
        });
        if (!response.ok) {
          setError("Could not create the collection. Please try again.");
          setIsSubmitting(false);
          return;
        }
        const created: Collection = await response.json();
        collectionId = created.id;
      }

      if (!collectionId) {
        setError("Choose a collection to add to.");
        setIsSubmitting(false);
        return;
      }

      const added = await addItem(collectionId);
      if (!added) {
        setError("Could not add to the collection. Please try again.");
        setIsSubmitting(false);
        return;
      }

      notifyCollectionsChanged();
      setIsSubmitting(false);
      setOpen(false);
    } catch {
      setError("Could not add to the collection. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
          title="Add to collection"
        >
          <FolderPlus className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to collection</DialogTitle>
          <DialogDescription>
            Save the whole video or a single chapter to one of your collections.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-scope">What to add</Label>
            <select
              id="add-scope"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className="border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm"
            >
              <option value={WHOLE_VIDEO}>Whole video</option>
              {chapterScopes.map((chapter, index) => {
                const range = formatRange(chapter.startSec, chapter.endSec);
                return (
                  <option key={index} value={String(index)}>
                    {chapter.title}
                    {range ? ` (${range})` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Collection</Label>
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-[var(--color-text-secondary)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading collections...
              </div>
            ) : (
              <div className="space-y-1.5">
                {collections.map((collection) => {
                  const selected = destination === collection.id;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => setDestination(collection.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                        selected
                          ? "border-[var(--color-accent)]/50 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
                          : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
                      )}
                    >
                      <span className="truncate">{collection.title}</span>
                      {selected && (
                        <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setDestination(NEW_COLLECTION)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                    destination === NEW_COLLECTION
                      ? "border-[var(--color-accent)]/50 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
                      : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
                  )}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  New collection
                </button>

                {destination === NEW_COLLECTION && (
                  <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="add-new-collection-title">Title</Label>
                      <Input
                        id="add-new-collection-title"
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="e.g. React performance talks"
                        maxLength={200}
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="add-new-collection-description">Description</Label>
                      <Textarea
                        id="add-new-collection-description"
                        value={newDescription}
                        onChange={(event) => setNewDescription(event.target.value)}
                        placeholder="Optional. What is this collection about?"
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding
                </>
              ) : (
                "Add"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
