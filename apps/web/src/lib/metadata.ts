import { fetchMetadata } from "@brief/core";
import type { VideoMetadata } from "./types";

/**
 * Throwing wrapper around `@brief/core`'s `fetchMetadata`. Preserves the
 * existing API-route call-site contract (return metadata, throw on failure)
 * with the user-facing error messages this app has historically surfaced.
 *
 * Discriminated-union handling can be folded into the API routes themselves
 * when the transcript-fetcher migration (#77) refactors the SSE pipeline.
 */
export async function fetchVideoMetadata(
  videoId: string,
  apiKey: string
): Promise<VideoMetadata> {
  const result = await fetchMetadata(videoId, { youtubeApiKey: apiKey });

  if (result.kind === "ok") return result.metadata;

  if (result.kind === "unavailable") {
    switch (result.reason) {
      case "invalid-id":
        throw new Error("Invalid video ID format");
      case "video-not-found":
        throw new Error(
          "Video not found or unavailable (may be private or deleted)"
        );
      case "quota-exceeded":
        throw new Error(
          "YouTube API quota exceeded. Try again tomorrow or use a different API key."
        );
      case "api-key-invalid":
        throw new Error(
          "Invalid YouTube API key or insufficient permissions. Get a key at: https://console.cloud.google.com/"
        );
    }
  }

  throw new Error(`Failed to fetch video metadata: ${result.message}`);
}
