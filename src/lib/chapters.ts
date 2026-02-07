import getYouTubeChapters from "get-youtube-chapters";
import type { Chapter } from "./types";

/**
 * Parses ISO 8601 duration (e.g., "PT1H2M30S") to total seconds
 */
export function parseDurationToSeconds(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formats seconds to MM:SS timestamp
 */
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Extracts chapters from a YouTube video description
 *
 * @param description - Video description text
 * @param durationIso - Video duration in ISO 8601 format (e.g., "PT1H2M30S")
 * @returns Array of chapters with calculated end timestamps, or null if no valid chapters found
 */
export function extractChapters(
  description: string,
  durationIso: string
): Chapter[] | null {
  const durationSeconds = parseDurationToSeconds(durationIso);
  if (durationSeconds === 0) return null;

  // Use the library to parse chapters from description
  const parsedChapters = getYouTubeChapters(description);

  // Deduplicate by start time (keep first occurrence)
  const seen = new Set<number>();
  const exactDeduped = parsedChapters.filter((chapter) => {
    if (seen.has(chapter.start)) return false;
    seen.add(chapter.start);
    return true;
  });

  // Proximity dedup: descriptions often list timestamps twice (TOC + detailed notes)
  // with slight variations (e.g., 2:30 vs 2:31). Collapse chapters starting within
  // 2 seconds of an already-accepted chapter.
  const uniqueChapters = exactDeduped.reduce<typeof exactDeduped>((accepted, chapter) => {
    if (accepted.length === 0) return [chapter];
    const tooClose = accepted.some(
      (prev) => Math.abs(prev.start - chapter.start) <= 2
    );
    if (!tooClose) accepted.push(chapter);
    return accepted;
  }, []);

  // YouTube requires minimum 3 chapters, first must start at 0:00
  if (uniqueChapters.length < 3) return null;
  if (uniqueChapters[0].start !== 0) return null;

  // Transform and calculate end timestamps
  const chapters: Chapter[] = uniqueChapters.map((chapter, index) => {
    const startSeconds = chapter.start;
    // End time is next chapter's start, or video duration for last chapter
    const endSeconds =
      index < uniqueChapters.length - 1
        ? uniqueChapters[index + 1].start
        : durationSeconds;

    return {
      title: chapter.title,
      startSeconds,
      endSeconds,
      timestampStart: formatTimestamp(startSeconds),
      timestampEnd: formatTimestamp(endSeconds),
    };
  });

  return chapters;
}
