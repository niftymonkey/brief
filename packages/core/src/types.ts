export type SourceName = "youtube-transcript-plus" | "supadata";

export type UnavailableReason =
  | "no-captions"
  | "video-removed"
  | "video-private"
  | "invalid-id";

// Legacy flat shape — predates the CLI→server submission's discriminated-union
// `TranscriptEntrySchema` (kind: "speech" | "visual") in `./submission`. The
// unification across consumers (format.ts, fetcher.ts, sources/*, web's
// transcript path) lands alongside #87's visual-entry producer, since that's
// when a sum-type carries weight downstream.
export type TranscriptEntry = {
  offsetSec: number;
  durationSec: number;
  text: string;
  lang?: string;
};

export type TranscriptResult =
  | {
      kind: "ok";
      source: SourceName;
      lang?: string;
      entries: TranscriptEntry[];
    }
  | {
      kind: "pending";
      source: SourceName;
      jobId: string;
      retryAfterSeconds: number;
      message: string;
    }
  | {
      kind: "unavailable";
      reason: UnavailableReason;
      message: string;
    }
  | {
      kind: "transient";
      cause: string;
      message: string;
    };

export type RetryPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
};

export interface TranscriptCache {
  get(videoId: string): Promise<TranscriptResult | null>;
  set(videoId: string, result: TranscriptResult): Promise<void>;
}

export type TranscriptOptions = {
  supadataApiKey?: string;
  signal?: AbortSignal;
  sources?: SourceName[];
  retryPolicy?: RetryPolicy;
  cache?: TranscriptCache;
};

export type MetadataUnavailableReason =
  | "video-not-found"
  | "invalid-id"
  | "quota-exceeded"
  | "api-key-invalid";

export type VideoMetadata = {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  duration: string;
  publishedAt: string;
  description: string;
  pinnedComment?: string;
  /**
   * The video's frame shape, as width divided by height: 1.7778 for 16:9,
   * 0.5625 for a vertical Short, 1.3333 for 4:3 archive footage. `null` when
   * YouTube reported no dimensions for it, which readers should treat as
   * unknown rather than as any particular shape.
   *
   * Optional so consumers that build a `VideoMetadata` from a source with no
   * frame information at all can leave it off entirely.
   */
  aspectRatio?: number | null;
};

export type MetadataResult =
  | { kind: "ok"; metadata: VideoMetadata }
  | {
      kind: "unavailable";
      reason: MetadataUnavailableReason;
      message: string;
    }
  | { kind: "transient"; cause: string; message: string };

export type MetadataOptions = {
  youtubeApiKey: string;
  signal?: AbortSignal;
  retryPolicy?: RetryPolicy;
};
