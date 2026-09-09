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
import { deleteTopicAction } from "@/app/(app)/topics/actions";

interface DeleteTopicButtonProps {
  topicId: string;
  name: string;
}

export function DeleteTopicButton({ topicId, name }: DeleteTopicButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBusy = isDeleting || isRedirecting;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      const result = await deleteTopicAction(topicId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIsRedirecting(true);
      router.push("/topics");
    } catch {
      setError("Could not delete this topic. Please try again.");
    } finally {
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
          title="Delete topic"
          aria-label="Delete topic"
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
              <DialogTitle>Delete topic?</DialogTitle>
              <DialogDescription>
                This permanently deletes &quot;{name}&quot; along with its trusted channels and
                standing searches. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-sm text-red-500">
                {error}
              </p>
            )}
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
