"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "youtube-digest-sidebar-enabled";

/**
 * Hook to determine if the sidebar feature is enabled.
 * Reads from localStorage, defaulting to false.
 *
 * To enable: localStorage.setItem("youtube-digest-sidebar-enabled", "true")
 * To disable: localStorage.setItem("youtube-digest-sidebar-enabled", "false")
 */
export function useSidebarEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null) {
        // Initialize to false if not set
        localStorage.setItem(STORAGE_KEY, "false");
      } else {
        setEnabled(stored === "true");
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  return enabled;
}
