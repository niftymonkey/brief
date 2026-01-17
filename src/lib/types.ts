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

export interface ContentSection {
  title: string;
  timestampStart: string;  // e.g., "0:00"
  timestampEnd: string;    // e.g., "5:30"
  keyPoints: string[];
}

export interface Tangent {
  title: string;
  timestampStart: string;
  timestampEnd: string;
  summary: string;
}

export interface StructuredDigest {
  summary: string;       // "At a Glance" overview of the video
  sections: ContentSection[];
  relatedLinks: Link[];  // Content-related links
  otherLinks: Link[];    // Social, sponsors, gear, etc.
  tangents?: Tangent[];  // Off-topic segments (optional)
}

export interface DigestResult {
  metadata: VideoMetadata;
  digest: StructuredDigest;
  outputPath: string;
}
