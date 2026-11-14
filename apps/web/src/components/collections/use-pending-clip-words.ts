/**
 * Keeps an owner's page in step with words the server writes after an add or
 * an edit: while any entry is pending, the collection is read again until its
 * words land or the wait runs out.
 */

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
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

const showsSameFootage = (a: CollectionItem, b: CollectionItem): boolean =>
  a.videoId === b.videoId && a.startSec === b.startSec && a.endSec === b.endSec;

/**
 * Takes only the words from the server's copy, so a reorder or edit in flight
 * keeps its place, and only for an entry still waiting on words for the footage
 * the server's copy describes.
 */
const mergeClipWords = (current: CollectionItem[], fetched: CollectionItem[]): CollectionItem[] =>
  current.map((item) => {
    if (item.summaryStatus !== "pending") return item;
    const latest = fetched.find((candidate) => candidate.id === item.id);
    if (!latest || !showsSameFootage(item, latest)) return item;
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

/**
 * Polls while any entry is pending. Returns the call the page makes as it
 * applies an edit the server answered: a read sent before that point may
 * predate the edit, so its answer is dropped and the next read is trusted.
 */
const usePendingClipWords = (
  collectionId: string,
  items: CollectionItem[],
  setItems: Dispatch<SetStateAction<CollectionItem[]>>,
  enabled: boolean,
): (() => void) => {
  const pendingIds = enabled ? pendingItemIds(items) : "";
  const editsApplied = useRef(0);

  useEffect(() => {
    if (pendingIds === "") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_DEADLINE_MS;

    const poll = async () => {
      const editsBeforeRead = editsApplied.current;
      const collection = await readCollection(collectionId);
      if (stopped) return;
      const predatesAnEdit = editsApplied.current !== editsBeforeRead;
      if (collection && !predatesAnEdit) setItems((previous) => mergeClipWords(previous, collection.items));
      if (Date.now() < deadline) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [collectionId, pendingIds, setItems]);

  return useCallback(() => {
    editsApplied.current += 1;
  }, []);
};

export { usePendingClipWords };
