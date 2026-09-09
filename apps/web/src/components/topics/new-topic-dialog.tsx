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
import { createTopicAction } from "@/app/(app)/topics/actions";
import type { VariantProps } from "class-variance-authority";

interface NewTopicDialogProps {
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

export function NewTopicDialog({ variant = "default" }: NewTopicDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [interests, setInterests] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setInterests("");
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await createTopicAction({ name, interests });
    if (!result.ok) {
      setError(result.error);
      setIsSubmitting(false);
      return;
    }

    setOpen(false);
    reset();
    router.push(`/topics/${result.slug}`);
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
          className={
            variant === "default"
              ? "bg-[var(--color-accent-dark)] !text-white hover:bg-[var(--color-accent)]"
              : undefined
          }
        >
          <Plus className="w-4 h-4" />
          New Topic
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Follow a new topic</DialogTitle>
          <DialogDescription>
            A topic is a subject you follow, with the channels and searches that feed it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic-name">Name</Label>
            <Input
              id="topic-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Rust"
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="topic-interests">What you care about</Label>
            <Textarea
              id="topic-interests"
              value={interests}
              onChange={(event) => setInterests(event.target.value)}
              placeholder="Optional. Async runtimes, compiler releases, and anything about the borrow checker."
              rows={3}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating
                </>
              ) : (
                "Create topic"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
