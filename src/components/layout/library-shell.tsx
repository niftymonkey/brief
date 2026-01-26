"use client";

import { type ReactNode } from "react";
import { LibrarySidebar } from "./library-sidebar";
import { LibraryToolbar } from "./library-toolbar";
import { ActiveFilters } from "@/components/filters";
import type { Tag } from "@/lib/types";

interface LibraryShellProps {
  children: ReactNode;
  availableTags?: Tag[];
}

export function LibraryShell({ children, availableTags = [] }: LibraryShellProps) {
  return (
    <div className="flex flex-1">
      {/* Desktop sidebar */}
      <LibrarySidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <LibraryToolbar availableTags={availableTags} />
        <ActiveFilters />

        <main
          className="flex-1 px-4 py-4 md:py-6"
          style={{ transition: "margin var(--sidebar-transition)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
