import type { ContentSection } from "./types";

export interface ChapterScope {
  title: string;
  startSec: number;
  endSec: number | null;
}

/**
 * Parses a clock timestamp (MM:SS or H:MM:SS) to whole seconds, or null when the
 * string is empty or not a valid non-negative clock value.
 */
function parseClock(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;

  const numbers = parts.map((part) => Number(part));
  const seconds = numbers[numbers.length - 1];
  const minutes = numbers[numbers.length - 2];
  if (minutes > 59 || seconds > 59) return null;

  if (numbers.length === 2) return minutes * 60 + seconds;
  return numbers[0] * 3600 + minutes * 60 + seconds;
}

/**
 * Derives the time range a brief's chapters map to when saved as collection
 * items. Each chapter's start comes from its own `timestampStart` (defaulting to
 * the video beginning when unparseable). Its end prefers its own `timestampEnd`,
 * falling back to the next chapter's start, and is left null only when neither is
 * available after the chapter's start (the final chapter of a video whose end is
 * genuinely unknown), which the caller saves as a start-only item.
 */
export function deriveChapterScopes(sections: ContentSection[]): ChapterScope[] {
  return sections.map((section, index) => {
    const startSec = parseClock(section.timestampStart) ?? 0;

    const ownEnd = parseClock(section.timestampEnd);
    if (ownEnd !== null && ownEnd > startSec) {
      return { title: section.title, startSec, endSec: ownEnd };
    }

    const nextStart =
      index + 1 < sections.length
        ? parseClock(sections[index + 1].timestampStart)
        : null;
    if (nextStart !== null && nextStart > startSec) {
      return { title: section.title, startSec, endSec: nextStart };
    }

    return { title: section.title, startSec, endSec: null };
  });
}
