"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseItemInput } from "@/components/collections/parse-item-input";

interface AddItemFormProps {
  onAdd: (videoId: string, startSec: number | null, endSec: number | null) => Promise<void>;
}

export function AddItemForm({ onAdd }: AddItemFormProps) {
  const [url, setUrl] = useState("");
  const [startSec, setStartSec] = useState("");
  const [endSec, setEndSec] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await onAdd(parsed.value.videoId, parsed.value.startSec, parsed.value.endSec);
      setUrl("");
      setStartSec("");
      setEndSec("");
    } catch {
      setError("Could not add the video. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="add-item-url">Add a video</Label>
          <Input
            id="add-item-url"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder="Paste a YouTube URL..."
          />
        </div>
        <div className="flex gap-3">
          <div className="w-24 space-y-1.5">
            <Label htmlFor="add-item-start">Start (s)</Label>
            <Input
              id="add-item-start"
              type="number"
              min={0}
              value={startSec}
              onChange={(event) => setStartSec(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="w-24 space-y-1.5">
            <Label htmlFor="add-item-end">End (s)</Label>
            <Input
              id="add-item-end"
              type="number"
              min={0}
              value={endSec}
              onChange={(event) => setEndSec(event.target.value)}
              placeholder="end"
            />
          </div>
        </div>
        <Button type="submit" disabled={!url.trim() || isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Adding
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Add
            </>
          )}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error}
        </p>
      )}
    </form>
  );
}
