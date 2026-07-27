"use client";

import Link from "next/link";
import { Youtube } from "lucide-react";

interface HeaderContentProps {
  /** Navigation that belongs beside the wordmark, at every width. */
  nav?: React.ReactNode;
  children: React.ReactNode;
}

export function HeaderContent({ nav, children }: HeaderContentProps) {
  return (
    <div className="h-14 flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 min-w-0">
        <Link
          href="/"
          className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Youtube className="w-5 h-5 shrink-0" />
          <span className="font-semibold">Brief</span>
        </Link>
        {nav}
      </div>

      <div className="flex items-center gap-4">
        {children}
      </div>
    </div>
  );
}
