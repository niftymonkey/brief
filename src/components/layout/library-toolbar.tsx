"use client";

import { PanelLeft } from "lucide-react";
import { DigestSearch } from "@/components/digest-search";
import { useLayout } from "./layout-context";
import { useSidebarEnabled } from "@/hooks/use-sidebar-enabled";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function LibraryToolbar() {
  const { sidebarOpen, toggleSidebar, isMobile } = useLayout();
  const sidebarEnabled = useSidebarEnabled();

  const label = sidebarOpen ? "Close sidebar (Ctrl/Cmd+B)" : "Open sidebar (Ctrl/Cmd+B)";

  return (
    <div className="sticky top-14 z-40 bg-[var(--color-bg-primary)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg-primary)]/80 border-b border-[var(--color-border)] py-3 px-4">
      <div className="flex items-center gap-3">
        {/* Sidebar toggle - only visible when sidebar feature is enabled */}
        {sidebarEnabled && !isMobile && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className={cn(
                    "p-2 -ml-2 rounded-lg cursor-pointer",
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

        <div className="flex-1">
          <DigestSearch />
        </div>
        {/* Future filter controls will go here */}
      </div>
    </div>
  );
}
