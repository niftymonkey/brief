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

export interface DigestConfig {
  anthropicApiKey: string;
  youtubeApiKey: string;
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
  keyPoints: KeyPoint[] | string[];  // KeyPoint[] for new digests, string[] for legacy
}

export interface StructuredDigest {
  summary: string;       // "At a Glance" overview of the video
  sections: ContentSection[];
  relatedLinks: Link[];  // Content-related links
  otherLinks: Link[];    // Social, sponsors, gear, etc.
  // Tangents are flagged on individual KeyPoints via isTangent
}

export interface DigestResult {
  metadata: VideoMetadata;
  digest: StructuredDigest;
  outputPath?: string;
}

// Database types
export interface DbDigest {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface DigestSummary {
  id: string;
  userId?: string;
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl: string | null;
  createdAt: Date;
}
