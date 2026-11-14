/**
 * Clip title backfill: gives every settled clip that has no title the AI title
 * it would have had, without touching its note or status.
 */

import { writeGeneratedClipTitle, type UntitledClip } from "./collections";
import { generateClipWords, type ClipWordsDeps } from "./clip-words";

type ClipTitleOutcome =
  | { kind: "written"; title: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string };

interface ClipTitleTally {
  written: number;
  skipped: number;
  failed: number;
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const backfillClipTitle = async (clip: UntitledClip, deps: ClipWordsDeps): Promise<ClipTitleOutcome> => {
  const generated = await generateClipWords(clip.ownerId, clip.item, clip.collection, "title", deps);
  if (generated.kind === "failed") return { kind: "failed", reason: generated.reason };
  if (generated.title === null) return { kind: "failed", reason: "the model answered without a title" };

  const written = await writeGeneratedClipTitle(clip.item, generated.title);
  if (!written) {
    return { kind: "skipped", reason: "the clip gained a title or moved onto other footage while this ran" };
  }
  return { kind: "written", title: generated.title };
};

/**
 * Titles each clip in turn, one model call at a time, and hands every
 * outcome to `onOutcome` as it lands. A clip that fails, whether by a reported
 * failure or a thrown one, is reported and the run moves to the next.
 */
const backfillClipTitles = async (
  clips: UntitledClip[],
  deps: ClipWordsDeps,
  onOutcome: (clip: UntitledClip, outcome: ClipTitleOutcome) => void,
): Promise<ClipTitleTally> => {
  const tally: ClipTitleTally = { written: 0, skipped: 0, failed: 0 };
  for (const clip of clips) {
    let outcome: ClipTitleOutcome;
    try {
      outcome = await backfillClipTitle(clip, deps);
    } catch (error) {
      outcome = { kind: "failed", reason: `threw: ${describeError(error)}` };
    }
    tally[outcome.kind] += 1;
    onOutcome(clip, outcome);
  }
  return tally;
};

export { backfillClipTitles };
export type { ClipTitleOutcome, ClipTitleTally };
