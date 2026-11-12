/**
 * Runs a clip's words generation after the response that left it pending, so
 * every add or edit that needs words gets them whichever page made it.
 */

import { after } from "next/server";
import { isEmailAllowed } from "./access";
import { createClipWordsDeps, writeClipWords } from "./clip-words";
import { writeGeneratedClipWords, type CollectionItem } from "./collections";

interface ClipWordsRequester {
  id: string;
  email: string | null | undefined;
}

const runClipWords = async (userId: string, collectionId: string, item: CollectionItem): Promise<void> => {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.error(`[CLIP WORDS] Missing OPENROUTER_API_KEY, marking item ${item.id} failed`);
    await writeGeneratedClipWords(userId, collectionId, item, { status: "failed" });
    return;
  }
  await writeClipWords(userId, collectionId, item.id, createClipWordsDeps(openRouterKey));
};

const scheduleClipWords = (requester: ClipWordsRequester, collectionId: string, item: CollectionItem): void => {
  if (item.summaryStatus !== "pending") return;
  // Generation spends tokens, which only the allowlist may do, the same gate
  // the retry route applies.
  if (!isEmailAllowed(requester.email)) {
    console.warn(`[CLIP WORDS] ${requester.id} is not allowlisted, leaving item ${item.id} pending`);
    return;
  }
  after(async () => {
    try {
      await runClipWords(requester.id, collectionId, item);
    } catch (error) {
      console.error(`[CLIP WORDS] background run for item ${item.id} threw:`, error);
    }
  });
};

export { scheduleClipWords };
