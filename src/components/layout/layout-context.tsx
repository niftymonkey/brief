"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSidebarEnabled } from "@/hooks/use-sidebar-enabled";

export type LayoutMode = "compact" | "expanded";

// Sidebar width constraints (in pixels)
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_DEFAULT_WIDTH = 256;

interface LayoutContextValue {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  isMobile: boolean;
  mounted: boolean;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

const STORAGE_KEY = "youtube-digest-layout-mode";
const SIDEBAR_WIDTH_KEY = "youtube-digest-sidebar-width";

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>("compact");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidthState] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [mounted, setMounted] = useState(false);
  const isMobile = !useMediaQuery("(min-width: 768px)");

  // Load mode and sidebar width from localStorage on mount
  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(STORAGE_KEY);
      if (storedMode === "compact" || storedMode === "expanded") {
        setModeState(storedMode);
      }

      const storedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (storedWidth) {
        const width = parseInt(storedWidth, 10);
        if (!isNaN(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
          setSidebarWidthState(width);
        }
      }
    } catch {
      // localStorage unavailable (private browsing, quota exceeded)
    }

    setMounted(true);
  }, []);

  const setMode = useCallback((newMode: LayoutMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    const clampedWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidthState(clampedWidth);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampedWidth));
    } catch {
      // localStorage unavailable
    }
  }, []);

  return (
    <LayoutContext.Provider
      value={{
        mode,
        setMode,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth,
        isMobile,
        mounted,
      }}
    >
      {children}
      <SidebarKeyboardShortcutHandler />
    </LayoutContext.Provider>
  );
}

/**
 * Internal component for keyboard shortcut - must be inside provider
 */
function SidebarKeyboardShortcutHandler() {
  const { toggleSidebar } = useLayout();
  const sidebarEnabled = useSidebarEnabled();

  useHotkeys("mod+b", toggleSidebar, {
    enabled: sidebarEnabled,
    preventDefault: true,
  });

  return null;
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
}
