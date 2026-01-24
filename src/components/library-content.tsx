"use client";

import { type ReactNode } from "react";
import { useLayout, type LayoutMode } from "./layout/layout-context";
import { LibraryShell as Shell } from "./layout/library-shell";
import { DigestSearch } from "./digest-search";
import { cn } from "@/lib/utils";

// Re-export the shell for convenience
export { Shell as LibraryShell };

function getGridClasses(mode: LayoutMode, mounted: boolean): string {
  return !mounted || mode === "compact"
    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
    : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
}

/**
 * Renders DigestSearch only in compact mode (expanded mode has it in the toolbar)
 */
export function CompactModeSearch() {
  const { mode, mounted } = useLayout();

  // In expanded mode, search is in the toolbar
  if (mounted && mode === "expanded") {
    return null;
  }

  return (
    <div className="mb-6">
      <DigestSearch />
    </div>
  );
}

interface DigestGridProps {
  children: ReactNode;
}

/**
 * Responsive grid wrapper that adjusts columns based on layout mode
 * - Compact: max 3 columns (current behavior)
 * - Expanded: up to 5 columns on wide screens
 */
export function DigestGrid({ children }: DigestGridProps) {
  const { mode, mounted } = useLayout();
  const gridClasses = getGridClasses(mode, mounted);

  return (
    <div className={cn("grid gap-4", gridClasses)}>
      {children}
    </div>
  );
}

interface DigestGridSkeletonProps {
  count?: number;
}

export function DigestGridSkeleton({ count = 6 }: DigestGridSkeletonProps) {
  const { mode, mounted } = useLayout();
  const gridClasses = getGridClasses(mode, mounted);

  return (
    <div className={cn("grid gap-4", gridClasses)}>
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] animate-pulse"
        >
          <div className="aspect-video rounded-lg bg-[var(--color-bg-tertiary)] mb-3" />
          <div className="h-5 bg-[var(--color-bg-tertiary)] rounded w-3/4 mb-2" />
          <div className="h-4 bg-[var(--color-bg-tertiary)] rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}
