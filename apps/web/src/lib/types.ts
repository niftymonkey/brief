export interface VideoMetadata {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  duration: string;
  publishedAt: string;
  description: string;
  pinnedComment?: string;
}

export interface Chapter {
  title: string;
  startSeconds: number;
  endSeconds: number;
  timestampStart: string; // MM:SS format
  timestampEnd: string; // MM:SS format
}

export interface TranscriptEntry {
  text: string;
  offset: number;    // in seconds
  duration: number;  // in seconds
  lang?: string;
}

export interface Link {
  url: string;
  title: string;     // Short, concise title for the link
  description: string; // What the link is and why it's relevant
}

export interface KeyPoint {
  text: string;
  timestamp: string;  // Approximate timestamp when this point is discussed (MM:SS format)
  isTangent?: boolean;  // True if this point diverges from the chapter's stated topic
}

export interface ContentSection {
  title: string;
  timestampStart: string;  // e.g., "0:00"
  timestampEnd: string;    // e.g., "5:30"
  keyPoints: KeyPoint[] | string[];  // KeyPoint[] for new briefs, string[] for legacy
}

export interface StructuredBrief {
  summary: string;       // "At a Glance" overview of the video
  sections: ContentSection[];
  relatedLinks: Link[];  // Content-related links
  otherLinks: Link[];    // Social, sponsors, gear, etc.
  // Tangents are flagged on individual KeyPoints via isTangent
}

export interface BriefResult {
  metadata: VideoMetadata;
  brief: StructuredBrief;
  outputPath?: string;
}

/**
 * Status of the optional video-frames augmentation for a brief.
 *
 * - `not-requested` — frames weren't requested for this generation (default).
 * - `included`      — frames were requested and successfully woven in.
 * - `attempted-failed` — frames were requested but the pipeline failed; the
 *                       brief still generated from the transcript alone.
 *
 * Only `not-requested` is written by today's code path. The frames feature
 * (#87) populates the other values when it lands.
 */
export type FramesStatus = "not-requested" | "included" | "attempted-failed";

/**
 * Per-generation telemetry persisted alongside each brief. Token counts and
 * model are the durable factual data; cost is derived at read time via
 * `estimateCost(model, in, out)` from `@brief/core` so the row stays currency-
 * and pricing-snapshot agnostic.
 */
export interface BriefMetrics {
  inputTokens: number;
  outputTokens: number;
  model: string;     // e.g. "openai/gpt-5.5" (OpenRouter form)
  latencyMs: number;
}

/**
 * Canonical stored shape for a brief's transcript. Uses `@brief/core`'s entry
 * field names (`offsetSec` / `durationSec`) so downstream LLM consumers can
 * read the JSONB and pass it straight into `formatTranscript()` from core.
 */
export interface StoredTranscriptEntry {
  text: string;
  offsetSec: number;
  durationSec: number;
  lang?: string;
}

export type SourceName = "youtube-transcript-plus" | "supadata";

export interface StoredTranscript {
  entries: StoredTranscriptEntry[];
  source: SourceName;
  lang?: string;
}

// Tag types
export interface Tag {
  id: string;
  name: string;
  usageCount?: number; // Number of briefs using this tag
}

// Database types
export interface DbBrief {
  id: string;
  userId: string;
  videoId: string;
  title: string;
  channelName: string;
  channelSlug: string;
  duration: string | null;
  publishedAt: Date | null;
  thumbnailUrl: string | null;
  summary: string;
  sections: ContentSection[];
  relatedLinks: Link[];
  otherLinks: Link[];
  isShared: boolean;
  slug: string | null;
  hasCreatorChapters: boolean | null;
  status: string;
  errorMessage: string | null;
  transcript: StoredTranscript | null;
  metrics: BriefMetrics | null;
  framesStatus: FramesStatus;
  createdAt: Date;
  updatedAt: Date;
  tags?: Tag[];
}

export interface BriefSummary {
  id: string;
  userId?: string;
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  createdAt: Date;
  tags?: Tag[];
}
