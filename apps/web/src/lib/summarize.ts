import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import { DIGEST_MODEL, formatTranscript } from "@brief/core";
import type { TranscriptResult } from "@brief/core";
import type {
  BriefMetrics,
  Chapter,
  ContentSection,
  KeyPoint,
  StructuredBrief,
  TranscriptEntry,
  VideoMetadata,
} from "./types";
import { combineUrls } from "./url-extractor";
import { systemPrompt, buildUserPrompt, buildChapterUserPrompt } from "./prompts";

/**
 * Parses a timestamp string (MM:SS or H:MM:SS) to seconds
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3) {
    // H:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Merges tangent-only chapters into adjacent substantive chapters (for auto-generated chapters only).
 * This is a safety net in case the LLM creates a chapter with only tangent content.
 */
function mergeTangentOnlyChapters(
  sections: ContentSection[],
  hasCreatorChapters: boolean
): ContentSection[] {
  // Don't modify creator-defined chapters - respect their structure
  if (hasCreatorChapters) return sections;

  const result: ContentSection[] = [];
  // Buffer for leading tangent-only sections (before first substantive section)
  let leadingTangents: ContentSection[] = [];

  for (const section of sections) {
    // Check if this section has any substantive (non-tangent) key points
    const hasSubstantivePoints = section.keyPoints.some((kp) => {
      // Legacy string[] format - assume substantive
      if (typeof kp === "string") return true;
      // KeyPoint format - check isTangent flag
      return !kp.isTangent;
    });

    if (!hasSubstantivePoints) {
      if (result.length > 0) {
        // Merge into previous substantive chapter
        const prev = result[result.length - 1];
        (prev.keyPoints as KeyPoint[]).push(...(section.keyPoints as KeyPoint[]));
        prev.timestampEnd = section.timestampEnd;
      } else {
        // Buffer leading tangent-only sections
        leadingTangents.push(section);
      }
    } else {
      // Found a substantive section
      if (leadingTangents.length > 0) {
        // Merge buffered leading tangents into this first substantive section
        const allLeadingPoints = leadingTangents.flatMap(s => s.keyPoints as KeyPoint[]);
        const mergedSection: ContentSection = {
          ...section,
          timestampStart: leadingTangents[0].timestampStart,
          keyPoints: [...allLeadingPoints, ...(section.keyPoints as KeyPoint[])],
        };
        result.push(mergedSection);
        leadingTangents = [];
      } else {
        result.push(section);
      }
    }
  }

  // If ALL sections were tangent-only, return them as-is (edge case)
  if (result.length === 0 && leadingTangents.length > 0) {
    return leadingTangents;
  }

  return result;
}

/**
 * Sorts brief content chronologically:
 * - Sections (chapters) by their start timestamp
 * - Key points within each section by their timestamp
 */
function sortBriefChronologically(brief: StructuredBrief): StructuredBrief {
  // First sort sections by start timestamp
  const sortedSections = [...brief.sections].sort(
    (a, b) => parseTimestamp(a.timestampStart) - parseTimestamp(b.timestampStart)
  );

  // Then sort key points within each section
  const sectionsWithSortedPoints = sortedSections.map((section) => {
    // Legacy briefs have string[] keyPoints - skip sorting
    if (section.keyPoints.length === 0 || typeof section.keyPoints[0] === "string") {
      return section;
    }
    // Sort KeyPoint[] by timestamp
    const sortedPoints = [...(section.keyPoints as KeyPoint[])].sort(
      (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp)
    );
    return { ...section, keyPoints: sortedPoints };
  });

  return {
    ...brief,
    sections: sectionsWithSortedPoints,
  };
}

/**
 * Creates a Zod schema for structured brief output with configurable key points range
 */
function createBriefSchema(keyPointsMin: number, keyPointsMax: number) {
  return z.object({
    summary: z.string().describe("A brief 2-3 sentence TL;DW (Too Long; Didn't Watch) summary capturing the essence of the video"),

    sections: z.array(
      z.object({
        title: z.string().describe("Descriptive chapter heading for this content section"),
        timestampStart: z.string().describe("Start timestamp in MM:SS format (e.g., '0:00')"),
        timestampEnd: z.string().describe("End timestamp in MM:SS format (e.g., '5:30')"),
        keyPoints: z.array(
          z.object({
            text: z.string().describe("The synthesized takeaway or insight"),
            timestamp: z.string().describe("Approximate timestamp when this point is discussed (MM:SS format)"),
            isTangent: z.boolean().describe("True only for significant (30+ second) digressions from the chapter topic — not brief asides. Set false for all non-tangent points."),
          })
        ).describe(`${keyPointsMin}-${keyPointsMax} substantive takeaways, plus any significant tangents (tangents are additional, not counted against the ${keyPointsMin}-${keyPointsMax} requirement)`),
      })
    ).describe("Chapters (aim for 4-6) organizing the video content into major topic sections"),

    relatedLinks: z.array(
      z.object({
        url: z.string().describe("The URL"),
        title: z.string().describe("Short, concise title (2-5 words, e.g., 'Karpathy Tweet', 'RAMP AI Playbook')"),
        description: z.string().describe("What this link is and why it's relevant to the video content"),
      })
    ).describe("Links related to video content: documentation, tools mentioned, related videos, resources"),

    otherLinks: z.array(
      z.object({
        url: z.string().describe("The URL"),
        title: z.string().describe("Short, concise title (2-5 words, e.g., 'Sponsor Link', 'Twitter Profile')"),
        description: z.string().describe("What this link is (social media, sponsor, affiliate, etc.)"),
      })
    ).describe("Other links: social media, sponsors, affiliate links, creator's gear/setup"),
  });
}

/**
 * Generates a structured AI-powered brief of a video transcript.
 *
 * Model choice is driven by `DIGEST_MODEL` from `@brief/core` and routed
 * through OpenRouter so the model can change without an SDK swap.
 *
 * @param transcript - Array of transcript entries with timestamps
 * @param metadata - Video metadata including description and pinned comment
 * @param apiKey - OpenRouter API key
 * @param chapters - Optional creator-defined chapters to use as section structure
 * @returns Structured brief with sections and categorized links
 */
export async function generateBrief(
  transcript: TranscriptEntry[],
  metadata: VideoMetadata,
  apiKey: string,
  chapters?: Chapter[] | null
): Promise<{ brief: StructuredBrief; metrics: BriefMetrics }> {
  // Format transcript with `[M:SS] line` anchors via @brief/core's canonical
  // formatter. We wrap the in-memory web-shape entries in a TranscriptResult
  // stub because formatTranscript operates on results, not bare entries — the
  // source field is meaningless here (we already have the entries) but the
  // type requires it.
  const stubResult: TranscriptResult = {
    kind: "ok",
    source: "youtube-transcript-plus",
    ...(transcript[0]?.lang ? { lang: transcript[0].lang } : {}),
    entries: transcript.map((e) => ({
      offsetSec: e.offset,
      durationSec: e.duration,
      text: e.text,
      ...(e.lang ? { lang: e.lang } : {}),
    })),
  };
  const formattedTranscript = formatTranscript(stubResult, "timestamped");

  // Extract all URLs from description and pinned comment
  const allUrls = combineUrls(metadata.description, metadata.pinnedComment);

  // Use chapter-aware prompt if chapters exist, otherwise standard prompt
  const hasChapters = chapters && chapters.length > 0;
  const userPrompt = hasChapters
    ? buildChapterUserPrompt(
        metadata.title,
        metadata.channelTitle,
        formattedTranscript,
        allUrls,
        chapters
      )
    : buildUserPrompt(
        metadata.title,
        metadata.channelTitle,
        formattedTranscript,
        allUrls,
        metadata.duration
      );

  // Use 2-4 key points per chapter for quick scanning (worst case: 6 chapters × 4 points = 24 points ≈ 2 min read)
  const briefSchema = createBriefSchema(2, 4);

  try {
    const openrouter = createOpenRouter({ apiKey });
    const model = openrouter(DIGEST_MODEL);

    const startedAt = Date.now();
    const result = await generateText({
      model,
      output: Output.object({ schema: briefSchema }),
      system: systemPrompt,
      prompt: userPrompt,
    });
    const latencyMs = Date.now() - startedAt;

    const brief = result.output as StructuredBrief;

    // Deduplicate sections with the same title (LLM can occasionally produce duplicates)
    const seenTitles = new Set<string>();
    const dedupedSections = brief.sections.filter((section) => {
      const key = section.title.toLowerCase().trim();
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });

    // Post-process: merge tangent-only chapters (auto-generated chapters only)
    const processedSections = mergeTangentOnlyChapters(dedupedSections, !!hasChapters);

    // Sort sections and key points chronologically
    const finalBrief = sortBriefChronologically({
      ...brief,
      sections: processedSections,
    });

    const metrics: BriefMetrics = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      model: DIGEST_MODEL,
      latencyMs,
    };

    return { brief: finalBrief, metrics };
  } catch (error: any) {
    if (error.message?.includes("401") || error.message?.includes("authentication")) {
      throw new Error(
        "Invalid OpenRouter API key. Get a key at: https://openrouter.ai/keys"
      );
    }

    if (error.message?.includes("rate limit")) {
      throw new Error(
        "OpenRouter rate limit exceeded. Please wait and try again."
      );
    }

    throw new Error(`Failed to generate brief: ${error.message || JSON.stringify(error)}`);
  }
}
