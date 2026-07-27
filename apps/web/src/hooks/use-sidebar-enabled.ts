"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "brief-sidebar-enabled";

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Seeds the flag on first subscription so it is discoverable in devtools, and
 * listens for `storage` events so a change made in another tab takes effect
 * here too.
 */
function subscribe(onStoreChange: () => void): () => void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      localStorage.setItem(STORAGE_KEY, "false");
    }
  } catch {
    // localStorage unavailable (private browsing, quota exceeded)
  }

  const handler = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/**
 * Hook to determine if the sidebar feature is enabled.
 * Reads from localStorage, defaulting to false.
 *
 * To enable: localStorage.setItem("brief-sidebar-enabled", "true")
 * To disable: localStorage.setItem("brief-sidebar-enabled", "false")
 */
export function useSidebarEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
