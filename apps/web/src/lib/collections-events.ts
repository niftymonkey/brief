/**
 * Lightweight cross-component signal that the current user's collections list
 * (titles, item counts, membership) has changed, so passive views like the
 * sidebar can refetch without a shared data-fetching cache. Mirrors the
 * storage.onChanged pattern used in the extension: dispatch on mutation, listen
 * where the data is displayed.
 */
export const COLLECTIONS_CHANGED_EVENT = "brief:collections-changed";

export function notifyCollectionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
  }
}
