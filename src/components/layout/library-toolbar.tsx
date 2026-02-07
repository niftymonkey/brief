"use client";

import { PanelLeft } from "lucide-react";
import { DigestSearch } from "@/components/digest-search";
import {
  TagFilter,
  DateFilter,
  InlineTagFilter,
  InlineDateFilter,
} from "@/components/filters";
import { useLayout } from "./layout-context";
import { useSidebarEnabled } from "@/hooks/use-sidebar-enabled";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

interface LibraryToolbarProps {
  availableTags?: Tag[];
}

export function LibraryToolbar({ availableTags = [] }: LibraryToolbarProps) {
  const { sidebarOpen, toggleSidebar, isMobile } = useLayout();
  const sidebarEnabled = useSidebarEnabled();

  const label = sidebarOpen
    ? "Close sidebar (Ctrl/Cmd+B)"
    : "Open sidebar (Ctrl/Cmd+B)";

  return (
    <div
      data-toolbar
      className="sticky top-14 z-40 bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80 border-b border-[var(--color-border)] py-3 px-4"
    >
      {/* Single line above 900px (tags collapse to fit), wrap allowed below */}
      <div className="flex flex-wrap min-[900px]:flex-nowrap items-center gap-x-3 gap-y-3">
        {/* Sidebar toggle */}
        {sidebarEnabled && !isMobile && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className={cn(
                    "p-2 -ml-2 rounded-lg cursor-pointer shrink-0",
                    "text-[var(--color-text-secondary)]",
                    "hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]",
                    "transition-colors"
                  )}
                  aria-label={label}
                  aria-pressed={sidebarOpen}
                >
                  <PanelLeft className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{label}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Search - full width when wrapped, capped at 600px on single line */}
        <div
          data-search-container
          className="flex-[1_1_400px] min-w-[200px] min-[900px]:max-w-[600px]"
        >
          <DigestSearch />
        </div>

        {/* Filter section - grows into remaining space, can shrink */}
        <div
          data-filter-section
          className="flex items-center gap-3 flex-[1_1_0%] min-w-0"
        >
          {/* Separator - hide when likely wrapped */}
          <div className="hidden min-[900px]:block h-5 w-px shrink-0 bg-[var(--color-border)]" />

          {/* Inline tag pills */}
          <InlineTagFilter availableTags={availableTags} />

          {/* Separator */}
          <div className="h-5 w-px shrink-0 bg-[var(--color-border)]" />

          {/* Date presets */}
          <InlineDateFilter />
        </div>
      </div>
    </div>
  );
}
