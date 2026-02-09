"use client";

import { type ReactNode } from "react";
import { LibraryShell as Shell } from "./layout/library-shell";
import { cn } from "@/lib/utils";

// Re-export the shell for convenience
export { Shell as LibraryShell };

const gridClasses = "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

interface BriefGridProps {
  children: ReactNode;
}

/**
 * Responsive grid wrapper with up to 5 columns on wide screens
 */
export function BriefGrid({ children }: BriefGridProps) {
  return (
    <div className={cn("grid gap-4", gridClasses)}>
      {children}
    </div>
  );
}

interface BriefGridSkeletonProps {
  count?: number;
}

export function BriefGridSkeleton({ count = 6 }: BriefGridSkeletonProps) {
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
