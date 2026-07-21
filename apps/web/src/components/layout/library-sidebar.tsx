"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, Library } from "lucide-react";
import { useLayout } from "./layout-context";
import { useSidebarEnabled } from "@/hooks/use-sidebar-enabled";
import { cn } from "@/lib/utils";
import { COLLECTIONS_CHANGED_EVENT } from "@/lib/collections-events";
import type { Collection } from "@/lib/collections";

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
        <div className="flex-1 p-4 overflow-y-auto">
          <SidebarNav />
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

function SidebarNav() {
  const pathname = usePathname();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let generation = 0;

    const load = () => {
      const current = ++generation;
      fetch("/api/collections")
        .then((res) => {
          if (!res.ok) throw new Error(`Request failed: ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (!active || current !== generation || !Array.isArray(data)) return;
          setCollections(data);
          setLoadFailed(false);
        })
        .catch(() => {
          // Preserve whatever was last loaded; surface a quiet failure instead.
          if (active && current === generation) setLoadFailed(true);
        });
    };

    load();
    window.addEventListener(COLLECTIONS_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(COLLECTIONS_CHANGED_EVENT, load);
    };
  }, [pathname]);

  const linkClass = (active: boolean) =>
    cn(
      "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors truncate",
      active
        ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] font-medium"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
    );

  return (
    <nav className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <Link href="/" className={linkClass(pathname === "/")}>
          <Library className="w-4 h-4 shrink-0" />
          Your Library
        </Link>
      </div>

      <div className="flex flex-col gap-0.5">
        <Link
          href="/collections"
          className={linkClass(pathname === "/collections")}
        >
          <Layers className="w-4 h-4 shrink-0" />
          Collections
        </Link>
        {collections.length === 0 ? (
          <p className="pl-8 pr-2 py-1.5 text-sm text-[var(--color-text-tertiary)]">
            {loadFailed ? "Couldn't load collections" : "None yet"}
          </p>
        ) : (
          collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.id}`}
              className={cn(linkClass(pathname === `/collections/${collection.id}`), "pl-8")}
              title={collection.title}
            >
              <span className="truncate">{collection.title}</span>
              <span className="ml-auto shrink-0 text-xs text-[var(--color-text-tertiary)]">
                {collection.itemCount}
              </span>
            </Link>
          ))
        )}
      </div>
    </nav>
  );
}
