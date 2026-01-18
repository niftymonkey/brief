"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoMetadata, StructuredDigest } from "@/lib/types";

interface UrlInputProps {
  onDigestComplete: (data: { metadata: VideoMetadata; digest: StructuredDigest }) => void;
}

export function UrlInput({ onDigestComplete }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    // Basic YouTube URL validation
    const isYouTubeUrl = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/
    );

    if (!isYouTubeUrl) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create digest");
      }

      const data = await response.json();
      onDigestComplete(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl mx-auto">
      <div className="relative group">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="Paste a YouTube URL..."
          disabled={isLoading}
          className={cn(
            "w-full px-5 py-3.5 text-lg",
            "bg-[var(--color-bg-secondary)] border rounded-xl",
            "placeholder:text-[var(--color-text-tertiary)]",
            "focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20",
            "transition-all duration-200",
            "group-hover:border-[var(--color-border-hover)]",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            error
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
              : "border-[var(--color-border)]"
          )}
        />
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className={cn(
            "absolute right-1.5 top-1.5 bottom-1.5",
            "px-4 rounded-lg bg-[var(--color-accent)] text-white",
            "flex items-center justify-center",
            "hover:bg-[var(--color-accent-hover)] transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <ArrowRight className="w-5 h-5" />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
      )}
    </form>
  );
}
