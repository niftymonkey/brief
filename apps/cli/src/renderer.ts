import {
  formatTranscript,
  type MetadataResult,
  type TranscriptResult,
  type VideoMetadata,
} from "@brief/core";

export type CombinedResult = {
  videoIdOrUrl: string;
  transcript: TranscriptResult;
  metadata: MetadataResult | null;
};

export type RenderFormat = "human" | "json";

export type Rendered = { stdout: string; stderr: string };

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function render(
  combined: CombinedResult,
  format: RenderFormat,
  isTTY: boolean
): Rendered {
  return format === "json"
    ? renderJson(combined)
    : renderHuman(combined, isTTY);
}

function renderHuman(combined: CombinedResult, isTTY: boolean): Rendered {
  const { transcript, metadata, videoIdOrUrl } = combined;
  const headerLines = buildHeader(videoIdOrUrl, metadata, isTTY);
  const stderrLines = [...headerLines];

  let stdout = "";
  if (transcript.kind === "ok") {
    stdout = formatTranscript(transcript, "prose") + "\n";
  } else {
    stderrLines.push("");
    stderrLines.push(formatTranscript(transcript, "prose"));
  }

  return { stdout, stderr: stderrLines.join("\n") + "\n" };
}

function buildHeader(
  videoIdOrUrl: string,
  metadata: MetadataResult | null,
  isTTY: boolean
): string[] {
  const dim = (s: string): string => (isTTY ? `${DIM}${s}${RESET}` : s);
  const lines: string[] = [];
  const id = extractIdFromInput(videoIdOrUrl);

  if (metadata?.kind === "ok") {
    lines.push(`Title: ${metadata.metadata.title}`);
    lines.push(`Channel: ${metadata.metadata.channelTitle}`);
    lines.push(`Duration: ${metadata.metadata.duration}`);
  }
  lines.push(`Video ID: ${id}`);
  lines.push(`URL: ${videoIdOrUrl}`);

  return lines.map(dim);
}

function renderJson(combined: CombinedResult): Rendered {
  const baseStr = formatTranscript(combined.transcript, "json");
  const base = JSON.parse(baseStr) as Record<string, unknown>;

  const id = extractIdFromInput(combined.videoIdOrUrl);
  const url = isUrl(combined.videoIdOrUrl)
    ? combined.videoIdOrUrl
    : `https://www.youtube.com/watch?v=${id}`;

  const video: Record<string, unknown> = { id, url };
  if (combined.metadata?.kind === "ok") {
    const m: VideoMetadata = combined.metadata.metadata;
    video.title = m.title;
    video.channel = m.channelTitle;
    video.duration = m.duration;
    video.publishedAt = m.publishedAt;
  }
  base.video = video;

  return { stdout: JSON.stringify(base, null, 2) + "\n", stderr: "" };
}

function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function extractIdFromInput(input: string): string {
  const ID = /^[a-zA-Z0-9_-]{11}$/;
  if (ID.test(input)) return input;
  const match =
    input.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
    input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
    input.match(/embed\/([a-zA-Z0-9_-]{11})/);
  return match?.[1] ?? input;
}
