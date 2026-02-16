import { youtube_v3, youtube } from "@googleapis/youtube";
import type { VideoMetadata } from "./types";

/**
 * Fetches the pinned comment for a video (if available)
 */
async function fetchPinnedComment(
  youtubeClient: youtube_v3.Youtube,
  videoId: string
): Promise<string | undefined> {
  const response = await youtubeClient.commentThreads.list({
    videoId,
    part: ["snippet"],
    maxResults: 20, // Get top 20 comments to find pinned one
    order: "relevance",
  });

  const threads = response.data.items || [];

  // Find the pinned comment
  const pinnedThread = threads.find(
    (thread) => thread.snippet?.topLevelComment?.snippet?.textOriginal
  );

  if (pinnedThread?.snippet?.topLevelComment?.snippet?.textOriginal) {
    return pinnedThread.snippet.topLevelComment.snippet.textOriginal;
  }

  return undefined;
}

/**
 * Fetches video metadata from YouTube Data API v3
 *
 * @param videoId - YouTube video ID
 * @param apiKey - YouTube Data API key
 * @returns Video metadata including description and pinned comment
 * @throws Error if video not found, API key invalid, or quota exceeded
 */
export async function fetchVideoMetadata(
  videoId: string,
  apiKey: string
): Promise<VideoMetadata> {
  const youtubeClient = youtube({
    version: "v3",
    auth: apiKey,
  });

  try {
    const response = await youtubeClient.videos.list({
      id: [videoId],
      part: ["snippet", "contentDetails"],
    });

    const video = response.data.items?.[0];

    if (!video) {
      throw new Error(
        "Video not found or unavailable (may be private or deleted)"
      );
    }

    const snippet = video.snippet;
    const contentDetails = video.contentDetails;

    if (!snippet || !contentDetails) {
      throw new Error("Incomplete video data received from YouTube API");
    }

    // Fetch pinned comment
    let pinnedComment: string | undefined;
    try {
      pinnedComment = await fetchPinnedComment(youtubeClient, videoId);
    } catch {
      // Silently ignore comment fetch errors
      pinnedComment = undefined;
    }

    return {
      videoId,
      title: snippet.title || "Untitled",
      channelTitle: snippet.channelTitle || "Unknown Channel",
      channelId: snippet.channelId || "",
      duration: contentDetails.duration || "PT0S",
      publishedAt: snippet.publishedAt || new Date().toISOString(),
      description: snippet.description || "",
      pinnedComment,
    };
  } catch (error: any) {
    // Handle specific YouTube API errors
    if (error.code === 400) {
      throw new Error("Invalid video ID format");
    }
    if (error.code === 403) {
      if (error.message?.includes("quota")) {
        throw new Error(
          "YouTube API quota exceeded. Try again tomorrow or use a different API key."
        );
      }
      throw new Error(
        "Invalid YouTube API key or insufficient permissions. Get a key at: https://console.cloud.google.com/"
      );
    }
    if (error.code === 404) {
      throw new Error("Video not found");
    }

    // Re-throw if already our custom error
    if (error.message.includes("not found")) {
      throw error;
    }

    // Generic error
    throw new Error(`Failed to fetch video metadata: ${error.message}`);
  }
}
