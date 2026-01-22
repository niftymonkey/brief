"use client";

import { useState } from "react";
import { Share2, Check, Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ShareButtonProps {
  digestId: string;
  isShared: boolean;
  slug: string | null;
  title: string;
}

export function ShareButton({ digestId, isShared: initialIsShared, slug: initialSlug, title }: ShareButtonProps) {
  const [isShared, setIsShared] = useState(initialIsShared);
  const [slug, setSlug] = useState(initialSlug);
  const [isUpdating, setIsUpdating] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${slug}` : "";

  const handleToggleShare = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/digest/${digestId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isShared: !isShared, title }),
      });

      if (response.ok) {
        const data = await response.json();
        setIsShared(data.isShared);
        setSlug(data.slug);
        if (data.isShared) {
          setOpen(true);
        } else {
          setOpen(false);
        }
      }
    } catch (error) {
      console.error("Failed to toggle share:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleButtonClick = () => {
    if (!isShared) {
      handleToggleShare();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          onClick={handleButtonClick}
          disabled={isUpdating}
          variant="outline"
          size="icon-sm"
          className={isShared ? "text-[var(--color-accent)] border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]" : "text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"}
          title={isShared ? "Manage sharing" : "Share digest"}
        >
          {isUpdating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Share2 className="w-4 h-4" />
          )}
        </Button>
      </PopoverTrigger>
      {isShared && (
        <PopoverContent
          align="end"
          className="w-72 p-3 rounded-xl bg-[var(--color-bg-secondary)] border-[var(--color-border)]"
        >
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Share link
            </span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 h-auto px-3 py-2 text-sm bg-[var(--color-bg-primary)] border-[var(--color-border)] rounded-lg truncate"
            />
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors shrink-0 cursor-pointer"
              title="Copy link"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={handleToggleShare}
            disabled={isUpdating}
            className="w-full text-sm text-[var(--color-text-secondary)] hover:text-red-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isUpdating ? "Updating..." : "Stop sharing"}
          </button>
        </PopoverContent>
      )}
    </Popover>
  );
}
