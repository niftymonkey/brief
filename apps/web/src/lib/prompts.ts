import { readFileSync } from "fs";
import { join } from "path";
import type { Chapter } from "./types";

const promptsDir = join(process.cwd(), "src/lib/prompts");

/**
 * Parses ISO 8601 duration (e.g., "PT3H15M42S") to minutes
 */
function parseDurationToMinutes(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 60 + minutes + seconds / 60;
}

/**
 * Calculates recommended chapter count based on video duration
 * Aims for ~12-15 minute chapters, with sensible bounds
 */
function getChapterGuidance(durationMinutes: number): { min: number; max: number; perChapterPoints: string } {
  if (durationMinutes <= 15) {
    return { min: 3, max: 5, perChapterPoints: "2-3" };
  } else if (durationMinutes <= 30) {
    return { min: 4, max: 6, perChapterPoints: "2-4" };
  } else if (durationMinutes <= 60) {
    return { min: 5, max: 8, perChapterPoints: "2-4" };
  } else if (durationMinutes <= 120) {
    return { min: 8, max: 12, perChapterPoints: "3-5" };
  } else {
    // For very long videos (2+ hours), scale with duration
    const targetChapters = Math.round(durationMinutes / 12); // ~12 min per chapter
    const min = Math.max(10, Math.round(targetChapters * 0.8));
    const max = Math.min(25, Math.round(targetChapters * 1.2));
    return { min, max, perChapterPoints: "3-5" };
  }
}

/**
 * System prompt for the AI summarizer
 */
export const systemPrompt = readFileSync(join(promptsDir, "system.md"), "utf-8");

/**
 * User prompt template
 */
const userPromptTemplate = readFileSync(join(promptsDir, "user-template.md"), "utf-8");

/**
 * Chapter-aware user prompt template
 */
const chapterUserPromptTemplate = readFileSync(join(promptsDir, "user-template-chapters.md"), "utf-8");

/**
 * Builds the user prompt by replacing placeholders in the template
 */
export function buildUserPrompt(
  title: string,
  channelTitle: string,
  formattedTranscript: string,
  urls: string[],
  durationIso: string
): string {
  const urlsSection = urls.length > 0
    ? `URLs found in description/comments:\n${urls.join('\n')}`
    : '';

  const durationMinutes = parseDurationToMinutes(durationIso);
  const guidance = getChapterGuidance(durationMinutes);

  return userPromptTemplate
    .replace('{{TITLE}}', title)
    .replace('{{CHANNEL}}', channelTitle)
    .replace('{{DURATION_MINUTES}}', Math.round(durationMinutes).toString())
    .replace('{{CHAPTER_MIN}}', guidance.min.toString())
    .replace('{{CHAPTER_MAX}}', guidance.max.toString())
    .replace('{{POINTS_PER_CHAPTER}}', guidance.perChapterPoints)
    .replace('{{TRANSCRIPT}}', formattedTranscript)
    .replace('{{URLS}}', urlsSection);
}

/**
 * Builds the chapter-aware user prompt with creator-defined chapters
 */
export function buildChapterUserPrompt(
  title: string,
  channelTitle: string,
  formattedTranscript: string,
  urls: string[],
  chapters: Chapter[]
): string {
  const urlsSection = urls.length > 0
    ? `URLs found in description/comments:\n${urls.join('\n')}`
    : '';

  const chaptersSection = chapters
    .map((ch) => `- [${ch.timestampStart} - ${ch.timestampEnd}] ${ch.title}`)
    .join('\n');

  return chapterUserPromptTemplate
    .replace('{{TITLE}}', title)
    .replace('{{CHANNEL}}', channelTitle)
    .replace('{{TRANSCRIPT}}', formattedTranscript)
    .replace('{{URLS}}', urlsSection)
    .replace('{{CHAPTERS}}', chaptersSection);
}
