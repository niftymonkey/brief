import { youtube, type youtube_v3 } from "@googleapis/youtube";
import { extractVideoId } from "./parser";
import type {
  MetadataOptions,
  MetadataResult,
  MetadataUnavailableReason,
  VideoMetadata,
} from "./types";

export async function fetchMetadata(
  input: string,
  opts: MetadataOptions
): Promise<MetadataResult> {
  const videoId = extractVideoId(input);
  if (!videoId) {
    return {
      kind: "unavailable",
      reason: "invalid-id",
      message: `Could not extract a YouTube video ID from "${input}"`,
    };
  }

  const client = youtube({ version: "v3", auth: opts.youtubeApiKey });

  let response: { data: { items?: youtube_v3.Schema$Video[] } };
  try {
    response = await client.videos.list({
      id: [videoId],
      part: ["snippet", "contentDetails"],
    });
  } catch (err) {
    return mapError(err);
  }

  const video = response.data.items?.[0];
  if (!video) {
    return {
      kind: "unavailable",
      reason: "video-not-found",
      message: "Video not found or unavailable",
    };
  }

  const snippet = video.snippet;
  const contentDetails = video.contentDetails;

  const metadata: VideoMetadata = {
    videoId,
    title: snippet?.title ?? "Untitled",
    channelTitle: snippet?.channelTitle ?? "Unknown Channel",
    channelId: snippet?.channelId ?? "",
    duration: contentDetails?.duration ?? "PT0S",
    publishedAt: snippet?.publishedAt ?? new Date().toISOString(),
    description: snippet?.description ?? "",
  };

  const pinnedComment = await fetchPinnedComment(client, videoId);
  if (pinnedComment) metadata.pinnedComment = pinnedComment;

  return { kind: "ok", metadata };
}

async function fetchPinnedComment(
  client: youtube_v3.Youtube,
  videoId: string
): Promise<string | undefined> {
  try {
    const response = await client.commentThreads.list({
      videoId,
      part: ["snippet"],
      maxResults: 20,
      order: "relevance",
    });
    const items = response.data.items ?? [];
    for (const thread of items) {
      const text = thread.snippet?.topLevelComment?.snippet?.textOriginal;
      if (text) return text;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

type WithCode = { code?: number; message?: string };

function mapError(err: unknown): MetadataResult {
  const e = err as WithCode;
  const code = e?.code;
  const message = e?.message ?? "Failed to fetch video metadata";

  if (code === 400) {
    return mkUnavailable("invalid-id", message);
  }
  if (code === 404) {
    return mkUnavailable("video-not-found", message);
  }
  if (code === 403) {
    if (message.toLowerCase().includes("quota")) {
      return mkUnavailable("quota-exceeded", message);
    }
    return mkUnavailable("api-key-invalid", message);
  }

  const cause = err instanceof Error ? err.message : "unknown";
  return {
    kind: "transient",
    cause,
    message: `Transient failure fetching metadata: ${cause}`,
  };
}

function mkUnavailable(
  reason: MetadataUnavailableReason,
  message: string
): MetadataResult {
  return { kind: "unavailable", reason, message };
}
