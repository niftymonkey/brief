"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "./layout-context";
import { useSidebarEnabled } from "@/hooks/use-sidebar-enabled";
import { cn } from "@/lib/utils";

export function LibrarySidebar() {
  const { sidebarOpen, sidebarWidth, setSidebarWidth, isMobile } = useLayout();
  const sidebarEnabled = useSidebarEnabled();
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - left;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Prevent text selection while dragging
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, setSidebarWidth]);

  // Don't render if sidebar feature is disabled or on mobile
  if (!sidebarEnabled || isMobile) return null;

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "relative transition-[width] ease-out overflow-hidden",
        !isResizing && "duration-200"
      )}
      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
    >
      <aside
        className={cn(
          "h-full flex flex-col",
          "border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]",
          "transition-transform ease-out",
          !isResizing && "duration-200",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: sidebarWidth }}
      >
        <div className="flex-1 p-4">
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Filters and collections coming soon
          </p>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute top-0 right-0 h-full cursor-col-resize",
            "w-1 hover:w-1.5 transition-all",
            "bg-transparent hover:bg-[var(--color-border-hover)]",
            isResizing && "w-1.5 bg-[var(--color-border-hover)]"
          )}
        />
      </aside>
    </div>
  );
}
