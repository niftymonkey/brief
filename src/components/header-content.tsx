"use client";

import Link from "next/link";
import { Youtube } from "lucide-react";
import { useLayout } from "./layout/layout-context";
import { LayoutToggle } from "./layout/layout-toggle";
import { cn } from "@/lib/utils";

interface HeaderContentProps {
  children: React.ReactNode;
}

export function HeaderContent({ children }: HeaderContentProps) {
  const { mode, mounted } = useLayout();

  // Use compact styling until mounted to prevent hydration mismatch
  const isExpanded = mounted && mode === "expanded";

  return (
    <div
      className={cn(
        "h-14 flex items-center justify-between",
        !isExpanded && "max-w-5xl mx-auto"
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Youtube className="w-5 h-5" />
          <span className="font-semibold">YouTube Digest</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <LayoutToggle />
        {children}
      </div>
    </div>
  );
}
