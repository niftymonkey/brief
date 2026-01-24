"use client";

import { LayoutGrid, PanelLeft } from "lucide-react";
import { useLayout } from "./layout-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function LayoutToggle() {
  const { mode, setMode, isMobile, mounted } = useLayout();

  // Don't show on mobile
  if (isMobile) return null;

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="w-9 h-9" aria-hidden="true" />
    );
  }

  const isCompact = mode === "compact";
  const Icon = isCompact ? PanelLeft : LayoutGrid;
  const label = isCompact ? "Switch to expanded layout" : "Switch to compact layout";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setMode(isCompact ? "expanded" : "compact")}
            className={cn(
              "p-2 rounded-lg cursor-pointer",
              "text-[var(--color-text-secondary)]",
              "hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]",
              "transition-colors"
            )}
            aria-label={label}
          >
            <Icon className="w-5 h-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
