/**
 * Keeps an owner's page in step with words the server writes after an add or
 * an edit: while any entry is pending, the collection is read again until its
 * words land or the wait runs out.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { CollectionItem, CollectionWithItems } from "@/lib/collections";

const POLL_INTERVAL_MS = 2_000;
// Past this, generation has stalled rather than run long: the server gives a
// run sixty seconds, and a failed one lands as 'failed', which ends the wait.
const POLL_DEADLINE_MS = 90_000;

const pendingItemIds = (items: CollectionItem[]): string =>
  items
    .filter((item) => item.summaryStatus === "pending")
    .map((item) => item.id)
    .join(",");

/** Takes only the words from the server's copy, so a reorder or edit in flight keeps its place. */
const mergeClipWords = (current: CollectionItem[], fetched: CollectionItem[]): CollectionItem[] =>
  current.map((item) => {
    const latest = fetched.find((candidate) => candidate.id === item.id);
    if (!latest) return item;
    return {
      ...item,
      title: latest.title,
      titleAuthored: latest.titleAuthored,
      summary: latest.summary,
      summaryAuthored: latest.summaryAuthored,
      summaryStatus: latest.summaryStatus,
    };
  });

const readCollection = async (collectionId: string): Promise<CollectionWithItems | null> => {
  try {
    const response = await fetch(`/api/collections/${collectionId}`);
    if (!response.ok) {
      console.warn(`[CLIP WORDS] reading collection ${collectionId} answered ${response.status}`);
      return null;
    }
    const collection: CollectionWithItems = await response.json();
    return collection;
  } catch (error) {
    console.warn(`[CLIP WORDS] reading collection ${collectionId} failed:`, error);
    return null;
  }
};

const usePendingClipWords = (
  collectionId: string,
  items: CollectionItem[],
  setItems: Dispatch<SetStateAction<CollectionItem[]>>,
  enabled: boolean,
): void => {
  const pendingIds = enabled ? pendingItemIds(items) : "";

  useEffect(() => {
    if (pendingIds === "") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_DEADLINE_MS;

    const poll = async () => {
      const collection = await readCollection(collectionId);
      if (stopped) return;
      if (collection) setItems((previous) => mergeClipWords(previous, collection.items));
      if (Date.now() < deadline) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [collectionId, pendingIds, setItems]);
};

export { usePendingClipWords };
