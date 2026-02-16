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

interface DeleteBriefButtonProps {
  briefId: string;
}

export function DeleteBriefButton({ briefId }: DeleteBriefButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/brief/${briefId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Show redirecting state and navigate - dialog will unmount when navigation completes
        setIsDeleting(false);
        setIsRedirecting(true);
        router.push("/");
        router.refresh();
      } else {
        const data = await response.json();
        alert(data.error || "Failed to delete brief");
        setIsDeleting(false);
      }
    } catch {
      alert("Failed to delete brief");
      setIsDeleting(false);
    }
  };

  const isBusy = isDeleting || isRedirecting;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isBusy && setIsOpen(open)}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-red-500 hover:border-red-500/50 hover:bg-[var(--color-bg-tertiary)]"
          title="Delete brief"
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
              <DialogTitle>Delete brief?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. The brief will be permanently deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
