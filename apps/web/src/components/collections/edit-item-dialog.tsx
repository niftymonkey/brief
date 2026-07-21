"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
import { parseItemInput } from "@/components/collections/parse-item-input";

interface EditItemDialogProps {
  children: ReactNode;
  initialVideoId: string;
  initialStartSec: number | null;
  initialEndSec: number | null;
  onSubmit: (videoId: string, startSec: number | null, endSec: number | null) => Promise<void>;
}

export function EditItemDialog({
  children,
  initialVideoId,
  initialStartSec,
  initialEndSec,
  onSubmit,
}: EditItemDialogProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(`https://youtube.com/watch?v=${initialVideoId}`);
  const [startSec, setStartSec] = useState(initialStartSec === null ? "" : String(initialStartSec));
  const [endSec, setEndSec] = useState(initialEndSec === null ? "" : String(initialEndSec));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setUrl(`https://youtube.com/watch?v=${initialVideoId}`);
    setStartSec(initialStartSec === null ? "" : String(initialStartSec));
    setEndSec(initialEndSec === null ? "" : String(initialEndSec));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const parsed = parseItemInput(url, startSec, endSec);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(parsed.value.videoId, parsed.value.startSec, parsed.value.endSec);
      setOpen(false);
    } catch {
      setError("Could not update the video. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Replace video or range</DialogTitle>
          <DialogDescription>
            The item keeps its place in the collection. Its summary resets so you can write a fresh one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-item-url">YouTube URL</Label>
            <Input
              id="edit-item-url"
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              placeholder="Paste a YouTube URL..."
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <div className="w-28 space-y-1.5">
              <Label htmlFor="edit-item-start">Start (s)</Label>
              <Input
                id="edit-item-start"
                type="number"
                min={0}
                value={startSec}
                onChange={(event) => setStartSec(event.target.value)}
                placeholder="0"
              />
            </div>
            <div className="w-28 space-y-1.5">
              <Label htmlFor="edit-item-end">End (s)</Label>
              <Input
                id="edit-item-end"
                type="number"
                min={0}
                value={endSec}
                onChange={(event) => setEndSec(event.target.value)}
                placeholder="end"
              />
            </div>
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
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
