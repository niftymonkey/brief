"use client";

import { useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

/**
 * Everything the exposed share link needs. The row itself owns only the copy
 * feedback; enabling and disabling sharing belong to the collection.
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

const rowLabelClass =
  "basis-full min-[721px]:basis-auto text-[var(--color-text-tertiary)]";

export function CollectionShareRow({ share }: { share: CollectionShareState }) {
  const [copied, setCopied] = useState(false);

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
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 min-[721px]:gap-y-2.5 mt-5 pt-4 border-t border-[var(--color-border)] font-mono text-[0.6875rem] text-[var(--color-text-tertiary)]">
      <span className={rowLabelClass}>share link</span>

      {share.isShared && share.shareUrl ? (
        <>
          <span className="grow basis-0 min-[721px]:grow min-[721px]:basis-48 min-w-0 truncate px-2.5 py-1.5 rounded-md bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
            {share.shareUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy share link"
            title="Copy share link"
            className="w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <span className={rowLabelClass}>
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
          </span>
        </>
      ) : (
        <>
          <span className="grow basis-0 min-w-0 truncate px-2.5 py-1.5 rounded-md bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
            not shared yet
          </span>
          {share.canManage && (
            <button
              type="button"
              onClick={share.onEnable}
              disabled={share.busy}
              className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {share.busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              create link
            </button>
          )}
          <span className={rowLabelClass}>
            {share.canManage
              ? "creating a link lets anyone with it watch this through"
              : "this collection is private"}
          </span>
        </>
      )}

      {share.error && (
        <span role="alert" className="basis-full text-red-500">
          {share.error}
        </span>
      )}
    </div>
  );
}
