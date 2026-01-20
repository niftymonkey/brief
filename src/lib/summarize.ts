import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { TranscriptEntry, VideoMetadata, StructuredDigest, Chapter } from "./types";
import { combineUrls } from "./url-extractor";
import { systemPrompt, buildUserPrompt, buildChapterUserPrompt } from "./prompts";

/**
 * Formats a timestamp in seconds to MM:SS format
 */
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Creates a Zod schema for structured digest output with configurable key points range
 */
function createDigestSchema(keyPointsMin: number, keyPointsMax: number) {
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
            isTangent: z.boolean().optional().describe("True only for significant (30+ second) digressions from the chapter topic - not brief asides"),
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
 * Generates a structured AI-powered digest of a video transcript using Claude
 *
 * @param transcript - Array of transcript entries with timestamps
 * @param metadata - Video metadata including description and pinned comment
 * @param apiKey - Anthropic API key
 * @param chapters - Optional creator-defined chapters to use as section structure
 * @returns Structured digest with sections and categorized links
 */
export async function generateDigest(
  transcript: TranscriptEntry[],
  metadata: VideoMetadata,
  apiKey: string,
  chapters?: Chapter[] | null
): Promise<StructuredDigest> {
  // Format transcript with timestamps
  const formattedTranscript = transcript
    .map((entry) => {
      const timestamp = formatTimestamp(entry.offset);
      return `[${timestamp}] ${entry.text}`;
    })
    .join("\n");

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
  const digestSchema = createDigestSchema(2, 4);

  try {
    const anthropic = createAnthropic({ apiKey });
    const model = anthropic("claude-sonnet-4-5");

    const result = await generateText({
      model,
      output: Output.object({ schema: digestSchema }),
      system: systemPrompt,
      prompt: userPrompt,
    });

    return result.output as StructuredDigest;
  } catch (error: any) {
    if (error.message?.includes("401") || error.message?.includes("authentication")) {
      throw new Error(
        "Invalid Anthropic API key. Get a key at: https://console.anthropic.com/"
      );
    }

    if (error.message?.includes("rate limit")) {
      throw new Error(
        "Anthropic API rate limit exceeded. Please wait and try again."
      );
    }

    throw new Error(`Failed to generate digest: ${error.message || JSON.stringify(error)}`);
  }
}
