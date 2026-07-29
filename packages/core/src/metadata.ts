import { youtube, type youtube_v3 } from "@googleapis/youtube";
import { extractVideoId } from "./parser";
import type {
  MetadataOptions,
  MetadataResult,
  MetadataUnavailableReason,
  VideoMetadata,
} from "./types";

/**
 * The width `videos.list` is asked to size the embed player to.
 *
 * YouTube populates `player.embedWidth` and `player.embedHeight` only when the
 * request supplies a `maxWidth` or `maxHeight`, so this parameter is what turns
 * the `player` part into a source of real frame dimensions rather than just an
 * iframe snippet. Requesting it costs nothing: `videos.list` is billed at one
 * quota unit per call however many parts it names.
 */
const PLAYER_MAX_WIDTH = 8192;

/**
 * Decimal places kept on a derived aspect ratio.
 *
 * The embed dimensions are whole pixels YouTube already scaled to the requested
 * width, so digits past this are an artifact of that scaling rather than
 * information about the video. Four places resolve every shape a caller cares
 * to tell apart (0.5625 for a Short, 1.3333 for 4:3, 1.7778 for 16:9) and read
 * back out of a database as the numbers they were stored as.
 */
const ASPECT_RATIO_PRECISION = 4;

/**
 * Reads one reported embed dimension as a positive number of pixels.
 *
 * The API serialises these as JSON strings, so a string is the ordinary case
 * and a number is accepted alongside it. Accepts `unknown` because this is the
 * boundary with a third-party response: the declared type says what YouTube is
 * supposed to send, not what arrives.
 */
function positiveDimension(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const pixels = Number(value);
  return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
}

/**
 * Derives a video's frame shape as width divided by height, or `null` when
 * YouTube did not report dimensions for it.
 *
 * A number rather than a vertical/landscape flag, because 4:3 archive footage
 * is neither and a flag would have to file it under one of the two. Both
 * dimensions must be positive for a ratio to exist, which is also what keeps a
 * reported height of zero from dividing out to Infinity.
 */
function deriveAspectRatio(player: youtube_v3.Schema$VideoPlayer | undefined): number | null {
  const width = positiveDimension(player?.embedWidth);
  const height = positiveDimension(player?.embedHeight);
  if (width === null || height === null) return null;

  const factor = 10 ** ASPECT_RATIO_PRECISION;
  return Math.round((width / height) * factor) / factor;
}

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
      part: ["snippet", "contentDetails", "player"],
      maxWidth: PLAYER_MAX_WIDTH,
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
    aspectRatio: deriveAspectRatio(video.player),
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
