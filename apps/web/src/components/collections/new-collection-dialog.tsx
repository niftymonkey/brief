"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
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
import { notifyCollectionsChanged } from "@/lib/collections-events";
import type { Collection } from "@/lib/collections";
import type { VariantProps } from "class-variance-authority";

interface NewCollectionDialogProps {
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

export function NewCollectionDialog({ variant = "default" }: NewCollectionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        setError("Could not create the collection. Please try again.");
        setIsSubmitting(false);
        return;
      }

      const collection: Collection = await response.json();
      notifyCollectionsChanged();
      setOpen(false);
      reset();
      router.push(`/collections/${collection.id}`);
      router.refresh();
    } catch {
      setError("Could not create the collection. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={variant}
          className={variant === "default" ? "bg-[var(--color-accent-dark)] !text-white hover:bg-[var(--color-accent)]" : undefined}
        >
          <Plus className="w-4 h-4" />
          New Collection
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a new collection</DialogTitle>
          <DialogDescription>
            Group video clips into an ordered reference you write and curate yourself.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="collection-title">Title</Label>
            <Input
              id="collection-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. React performance talks"
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="collection-description">Description</Label>
            <Textarea
              id="collection-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional. What is this collection about?"
              rows={3}
            />
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
            <Button type="submit" disabled={!title.trim() || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating
                </>
              ) : (
                "Create collection"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
