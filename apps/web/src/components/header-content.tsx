"use client";

import Link from "next/link";
import { Youtube } from "lucide-react";

interface HeaderContentProps {
  children: React.ReactNode;
}

export function HeaderContent({ children }: HeaderContentProps) {
  return (
    <div className="h-14 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Youtube className="w-5 h-5" />
          <span className="font-semibold">Brief</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {children}
      </div>
    </div>
  );
}
