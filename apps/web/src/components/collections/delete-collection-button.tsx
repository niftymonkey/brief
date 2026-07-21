"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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
import { notifyCollectionsChanged } from "@/lib/collections-events";

interface DeleteCollectionButtonProps {
  collectionId: string;
  title: string;
}

export function DeleteCollectionButton({ collectionId, title }: DeleteCollectionButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isBusy = isDeleting || isRedirecting;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/collections/${collectionId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        notifyCollectionsChanged();
        setIsDeleting(false);
        setIsRedirecting(true);
        router.push("/collections");
        router.refresh();
      } else {
        const data = await response.json().catch(() => null);
        alert(data?.error || "Failed to delete collection");
        setIsDeleting(false);
      }
    } catch {
      alert("Failed to delete collection");
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isBusy && setIsOpen(open)}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-red-500 hover:border-red-500/50 hover:bg-[var(--color-bg-tertiary)]"
          title="Delete collection"
          aria-label="Delete collection"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!isBusy}>
        {isRedirecting ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
            <p className="text-[var(--color-text-secondary)]">Redirecting</p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete collection?</DialogTitle>
              <DialogDescription>
                This will permanently delete &quot;{title}&quot; and all of its items. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
