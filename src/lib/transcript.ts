import { Supadata } from "@supadata/js";
import { fetchTranscript as fetchYouTubeTranscript } from "youtube-transcript-plus";
import type { TranscriptEntry } from "./types";

/**
 * Fetches transcript using Supadata API (for cloud deployments)
 * Supadata returns timestamps in milliseconds, needs conversion to seconds
 */
async function fetchWithSupadata(videoId: string): Promise<TranscriptEntry[]> {
  const supadata = new Supadata({
    apiKey: process.env.SUPADATA_API_KEY!,
  });

  const result = await supadata.youtube.transcript({
    videoId,
  });

  // Handle async job case (unlikely for YouTube but SDK supports it)
  if ("jobId" in result) {
    throw new Error("Transcript generation queued - not supported yet");
  }

  // Handle case where content is a string (no timestamps)
  if (typeof result.content === "string") {
    throw new Error("Transcript returned without timestamps - cannot process");
  }

  // Convert to our TranscriptEntry format
  // Supadata returns offset/duration in milliseconds, we need seconds
  return result.content.map((entry) => ({
    text: entry.text,
    offset: entry.offset / 1000,
    duration: entry.duration / 1000,
    lang: result.lang,
  }));
}

/**
 * Fetches transcript using youtube-transcript-plus (for local development)
 * This library works without an API key but is blocked by YouTube on cloud platforms
 */
async function fetchWithYoutubeTranscriptPlus(
  videoId: string
): Promise<TranscriptEntry[]> {
  const rawTranscript = await fetchYouTubeTranscript(videoId);

  // youtube-transcript-plus returns timestamps already in seconds
  return rawTranscript.map((entry) => ({
    text: entry.text,
    offset: entry.offset,
    duration: entry.duration,
    lang: entry.lang,
  }));
}

/**
 * Fetches the transcript for a YouTube video
 *
 * Uses Supadata API when SUPADATA_API_KEY is set (required for cloud deployments),
 * otherwise falls back to youtube-transcript-plus (works locally without API key)
 *
 * @param videoId - YouTube video ID
 * @returns Array of transcript entries with timestamps
 * @throws Error if captions are disabled or unavailable
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptEntry[]> {
  const startTime = Date.now();
  const useSupadata = !!process.env.SUPADATA_API_KEY;

  console.log(
    `[TRANSCRIPT] Starting fetch for videoId: ${videoId} using ${useSupadata ? "Supadata API" : "youtube-transcript-plus (local mode)"}`
  );

  try {
    const entries = useSupadata
      ? await fetchWithSupadata(videoId)
      : await fetchWithYoutubeTranscriptPlus(videoId);

    console.log(
      `[TRANSCRIPT] Success in ${Date.now() - startTime}ms, entries: ${entries.length}`
    );

    return entries;
  } catch (error: unknown) {
    console.error(
      `[TRANSCRIPT] Failed in ${Date.now() - startTime}ms:`,
      error
    );

    const errorMsg =
      error instanceof Error ? error.message?.toLowerCase() : "";

    if (errorMsg.includes("disabled") || errorMsg.includes("not available")) {
      throw new Error(
        "No captions/transcript available for this video. Try a video with auto-generated or manual captions."
      );
    }

    if (errorMsg.includes("unavailable")) {
      throw new Error("Video is unavailable or has been removed");
    }

    if (errorMsg.includes("invalid")) {
      throw new Error("Invalid video ID");
    }

    // Supadata credit/billing errors
    if (
      errorMsg.includes("credit") ||
      errorMsg.includes("billing") ||
      errorMsg.includes("subscription") ||
      errorMsg.includes("limit exceeded")
    ) {
      throw new Error(
        "Supadata API credits exhausted. Please add credits in your Supadata dashboard."
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch transcript: ${message}`);
  }
}
