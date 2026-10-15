"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Everything the exposed share link needs. The popover owns only the copy feedback;
 * enabling and disabling sharing belong to the collection.
 */
export interface CollectionShareState {
  isShared: boolean;
  /** Absolute link to the public collection, null until the collection is shared. */
  shareUrl: string | null;
  /** Whether this viewer may turn sharing on and off. */
  canManage: boolean;
  busy: boolean;
  error: string | null;
  onEnable: () => void;
  onDisable: () => void;
}

/**
 * The share link as an icon button in the header's control cluster, the same
 * paradigm a brief's own share control uses.
 *
 * A collection that is not shared yet has its link created by the press that opens
 * the popover, so the panel opens on the work already in flight rather than asking
 * for a second click. Sharing itself is the collection's to change: this only reads
 * the state it is handed and calls back.
 */
export function CollectionSharePopover({ share }: { share: CollectionShareState }) {
  const [copied, setCopied] = useState(false);

  // A reader of an unshared collection has neither a link to copy nor the right to
  // make one, so there is no control to offer at all.
  if (!share.isShared && !share.canManage) return null;

  const handleTriggerClick = () => {
    if (!share.isShared && !share.busy) share.onEnable();
  };

  const handleCopy = async () => {
    if (!share.shareUrl) return;
    try {
      await navigator.clipboard.writeText(share.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          onClick={handleTriggerClick}
          variant="outline"
          size="icon-sm"
          title={share.isShared ? "Manage sharing" : "Share collection"}
          aria-label={share.isShared ? "Manage sharing" : "Share collection"}
          className={cn(
            "hover:bg-[var(--color-bg-tertiary)]",
            share.isShared
              ? "text-[var(--color-accent)] border-[var(--color-accent)]/50"
              : "text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50",
          )}
        >
          {share.busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Share2 className="w-4 h-4" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-3.5 rounded-xl bg-[var(--color-bg-secondary)] border-[var(--color-border-hover)]"
      >
        <div className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
          share link
        </div>

        {share.isShared && share.shareUrl ? (
          <>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                readOnly
                value={share.shareUrl}
                aria-label="Share link"
                className="grow min-w-0 px-2.5 py-1.5 rounded-lg font-mono text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
              />
              <button
                type="button"
                onClick={handleCopy}
                title="Copy share link"
                aria-label="Copy share link"
                className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2.5 font-mono text-[0.6875rem] text-[var(--color-text-tertiary)]">
              anyone with the link can watch it through
              {share.canManage && (
                <>
                  {" / "}
                  <button
                    type="button"
                    onClick={share.onDisable}
                    disabled={share.busy}
                    className="underline underline-offset-2 hover:text-[var(--color-accent)] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    stop sharing
                  </button>
                </>
              )}
            </p>
          </>
        ) : share.busy ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-tertiary)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Creating a link
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <p className="text-sm text-[var(--color-text-secondary)]">
              A link lets anyone who has it watch this collection through.
            </p>
            <Button size="sm" onClick={share.onEnable}>
              Create link
            </Button>
          </div>
        )}

        {share.error && (
          <p role="alert" className="mt-2.5 text-sm text-red-500">
            {share.error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
