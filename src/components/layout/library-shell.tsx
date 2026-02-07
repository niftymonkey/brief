"use client";

import { type ReactNode } from "react";
import { LibrarySidebar } from "./library-sidebar";
import { LibraryToolbar } from "./library-toolbar";
import { ActiveFilters } from "@/components/filters";
import {
  ContentPendingProvider,
  useContentPending,
} from "@/components/filters/content-pending-context";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

interface LibraryShellProps {
  children: ReactNode;
  availableTags?: Tag[];
}

export function LibraryShell({ children, availableTags = [] }: LibraryShellProps) {
  return (
    <ContentPendingProvider>
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <LibrarySidebar />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          <LibraryToolbar availableTags={availableTags} />
          <ActiveFilters />

          <LibraryContent>{children}</LibraryContent>
        </div>
      </div>
    </ContentPendingProvider>
  );
}

function LibraryContent({ children }: { children: ReactNode }) {
  const { isPending } = useContentPending();

  return (
    <main
      className={cn(
        "flex-1 px-4 py-4 md:py-6 transition-opacity duration-150",
        isPending && "opacity-60"
      )}
      style={{ transition: "margin var(--sidebar-transition), opacity 150ms" }}
    >
      {children}
    </main>
  );
}
