import { fetchTranscript as fetchYouTubeTranscript } from "youtube-transcript-plus";
import type { TranscriptEntry } from "./types";

/**
 * Fetches the transcript for a YouTube video
 *
 * @param videoId - YouTube video ID
 * @returns Array of transcript entries with timestamps
 * @throws Error if captions are disabled or unavailable
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptEntry[]> {
  try {
    const rawTranscript = await fetchYouTubeTranscript(videoId);

    // Convert to our TranscriptEntry format
    return rawTranscript.map((entry) => ({
      text: entry.text,
      offset: entry.offset, // youtube-transcript-plus returns offset in seconds
      duration: entry.duration, // duration in seconds
      lang: entry.lang,
    }));
  } catch (error: any) {
    const errorMsg = error.message?.toLowerCase() || "";

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

    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}
