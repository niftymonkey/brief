"use client";

import { useState, type FormEvent, type ReactNode } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { parseItemInput } from "@/components/collections/parse-item-input";
import type { CollectionItem } from "@/lib/collections";

/**
 * The fields of one clip an edit changes, and only those: a title or note present
 * here is the author's own (null hands it back to the AI), so one the author left
 * alone must be absent rather than resent.
 */
interface ClipEdit {
  title?: string | null;
  summary?: string | null;
  videoId?: string;
  startSec?: number | null;
  endSec?: number | null;
}

/** Typed words as the clip stores them: trimmed, with nothing left meaning none. */
const normalizeWords = (typed: string): string | null => {
  const trimmed = typed.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const secondsField = (sec: number | null): string => (sec === null ? "" : String(sec));

/** True while the AI is still writing this word of the clip, so its field has nothing to show yet. */
const isBeingWritten = (item: CollectionItem, words: string | null, authored: boolean): boolean =>
  item.summaryStatus === "pending" && !authored && words === null;

interface ClipDrafts {
  title: string;
  summary: string;
  url: string;
  startSec: string;
  endSec: string;
}

/**
 * The edit the drafts ask for against the clip as it stood when the popup opened.
 * Measured from that moment, so words the AI lands while the popup is open are not
 * mistaken for the author clearing them.
 */
const diffClipEdit = (
  opened: CollectionItem,
  drafts: ClipDrafts,
): { ok: true; edit: ClipEdit } | { ok: false; error: string } => {
  const parsed = parseItemInput(drafts.url, drafts.startSec, drafts.endSec);
  if (!parsed.ok) return parsed;

  const title = normalizeWords(drafts.title);
  const summary = normalizeWords(drafts.summary);
  const { videoId, startSec, endSec } = parsed.value;
  return {
    ok: true,
    edit: {
      ...(title !== normalizeWords(opened.title ?? "") && { title }),
      ...(summary !== normalizeWords(opened.summary ?? "") && { summary }),
      ...(videoId !== opened.videoId && { videoId }),
      ...(startSec !== opened.startSec && { startSec }),
      ...(endSec !== opened.endSec && { endSec }),
    },
  };
};

interface EditClipFormProps {
  item: CollectionItem;
  onSubmit: (edit: ClipEdit) => Promise<void>;
  onDone: () => void;
  onSubmittingChange: (isSubmitting: boolean) => void;
}

/**
 * The popup's body. It mounts each time the popup opens, which is what starts its
 * drafts, and the clip they are measured against, from the clip as it stands then.
 */
function EditClipForm({ item, onSubmit, onDone, onSubmittingChange }: EditClipFormProps) {
  const [opened] = useState(item);
  const [drafts, setDrafts] = useState<ClipDrafts>(() => ({
    title: item.title ?? "",
    summary: item.summary ?? "",
    url: `https://youtube.com/watch?v=${item.videoId}`,
    startSec: secondsField(item.startSec),
    endSec: secondsField(item.endSec),
  }));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleBeingWritten = isBeingWritten(opened, opened.title, opened.titleAuthored);
  const summaryBeingWritten = isBeingWritten(opened, opened.summary, opened.summaryAuthored);

  const setDraft = (field: keyof ClipDrafts, value: string) => {
    setDrafts((previous) => ({ ...previous, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const diff = diffClipEdit(opened, drafts);
    if (!diff.ok) {
      setError(diff.error);
      return;
    }
    if (Object.keys(diff.edit).length === 0) {
      onDone();
      return;
    }

    setIsSubmitting(true);
    onSubmittingChange(true);
    try {
      await onSubmit(diff.edit);
      onDone();
    } catch {
      setError("Could not save the clip. Please try again.");
    } finally {
      setIsSubmitting(false);
      onSubmittingChange(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-item-title">Title</Label>
        <Input
          id="edit-item-title"
          type="text"
          value={drafts.title}
          onChange={(event) => setDraft("title", event.target.value)}
          placeholder={
            titleBeingWritten
              ? "Being written for you..."
              : "Leave empty to have one written for you"
          }
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-item-note">Note</Label>
        <Textarea
          id="edit-item-note"
          value={drafts.summary}
          onChange={(event) => setDraft("summary", event.target.value)}
          placeholder={
            summaryBeingWritten
              ? "Being written for you..."
              : "Leave empty to have one written for you"
          }
          rows={4}
        />
      </div>

      {(titleBeingWritten || summaryBeingWritten) && (
        <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Still being written. Anything you type here replaces it.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="edit-item-url">YouTube URL</Label>
        <Input
          id="edit-item-url"
          type="text"
          value={drafts.url}
          onChange={(event) => setDraft("url", event.target.value)}
          placeholder="Paste a YouTube URL..."
        />
      </div>

      <div className="flex gap-3">
        <div className="w-28 space-y-1.5">
          <Label htmlFor="edit-item-start">Start (s)</Label>
          <Input
            id="edit-item-start"
            type="number"
            min={0}
            value={drafts.startSec}
            onChange={(event) => setDraft("startSec", event.target.value)}
            placeholder="0"
          />
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor="edit-item-end">End (s)</Label>
          <Input
            id="edit-item-end"
            type="number"
            min={0}
            value={drafts.endSec}
            onChange={(event) => setDraft("endSec", event.target.value)}
            placeholder="end"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={isSubmitting}>
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
  );
}

interface EditItemDialogProps {
  /** The control that opens the popup. */
  children: ReactNode;
  item: CollectionItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (edit: ClipEdit) => Promise<void>;
}

/** One popup for everything about a clip: its title, its note, and the footage it plays. */
function EditItemDialog({ children, item, open, onOpenChange, onSubmit }: EditItemDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSubmitting) return;
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit clip</DialogTitle>
          <DialogDescription>
            A title or note you write yourself is kept when the video or range changes. Leave
            either empty to have it written for you.
          </DialogDescription>
        </DialogHeader>
        <EditClipForm
          item={item}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
          onSubmittingChange={setIsSubmitting}
        />
      </DialogContent>
    </Dialog>
  );
}

export { EditItemDialog };
export type { ClipEdit };
