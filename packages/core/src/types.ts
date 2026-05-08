export type SourceName = "youtube-transcript-plus" | "supadata";

export type UnavailableReason =
  | "no-captions"
  | "video-removed"
  | "video-private"
  | "invalid-id";

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
