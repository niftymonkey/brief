import * as fs from "fs";
import * as path from "path";
import type { VideoMetadata, StructuredDigest, KeyPoint } from "./types";

/**
 * Parses a timestamp string (MM:SS or H:MM:SS) to seconds
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function isKeyPointArray(keyPoints: KeyPoint[] | string[]): keyPoints is KeyPoint[] {
  return keyPoints.length > 0 && typeof keyPoints[0] === "object";
}

function buildKeyPointsMarkdown(keyPoints: KeyPoint[] | string[]): string {
  if (isKeyPointArray(keyPoints)) {
    // New format with timestamps and tangent flags
    return keyPoints
      .map((kp) =>
        kp.isTangent
          ? `- *[tangent] ${kp.text}*`
          : `- ${kp.text}`
      )
      .join("\n");
  } else {
    // Legacy format - plain strings
    return keyPoints.map((point) => `- ${point}`).join("\n");
  }
}

/**
 * Creates a URL-safe slug from a string
 * Converts to lowercase, replaces special chars with hyphens, limits length
 */
function createSlug(text: string, maxLength: number = 60): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .substring(0, maxLength) // Limit length
    .replace(/-+$/, ""); // Remove trailing hyphen if substring cut mid-word
}

/**
 * Formats ISO 8601 duration (PT1H23M45S) to human-readable format
 */
function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Formats video metadata and structured digest into a complete markdown document
 *
 * @param metadata - Video metadata
 * @param digest - Structured digest with sections and links
 * @returns Formatted markdown document
 */
export function formatMarkdown(
  metadata: VideoMetadata,
  digest: StructuredDigest
): string {
  const publishDate = new Date(metadata.publishedAt).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  const generatedDate = new Date().toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Render section overview (quick navigation table with anchor links)
  const sectionRows = digest.sections
    .map((section, index) => {
      const anchor = `section-${index + 1}`;
      return `| [${section.title}](#${anchor}) | ${section.timestampStart} |`;
    })
    .join("\n");
  const sectionOverview = `| Chapter | Time |
|---------|-----:|
${sectionRows}`;

  // Render content sections
  const sectionsMarkdown = digest.sections
    .map((section, index) => {
      const anchor = `section-${index + 1}`;
      const contentMarkdown = buildKeyPointsMarkdown(section.keyPoints);

      return `### <a id="${anchor}"></a>${section.title} (${section.timestampStart} - ${section.timestampEnd})

${contentMarkdown}`;
    })
    .join("\n\n");

  // Render related links
  let relatedLinksMarkdown = "";
  if (digest.relatedLinks.length > 0) {
    relatedLinksMarkdown = `### Related Links

${digest.relatedLinks.map((link) => `- **[${link.title}](${link.url})** - ${link.description}`).join("\n")}`;
  }

  // Render other links
  let otherLinksMarkdown = "";
  if (digest.otherLinks.length > 0) {
    otherLinksMarkdown = `### Other Links

${digest.otherLinks.map((link) => `- **[${link.title}](${link.url})** - ${link.description}`).join("\n")}`;
  }

  return `# ${metadata.title}

**Channel**: ${metadata.channelTitle}
**Duration**: ${formatDuration(metadata.duration)}
**Published**: ${publishDate}
**Video**: https://youtube.com/watch?v=${metadata.videoId}
**Generated**: ${generatedDate}

---

## At a Glance

${digest.summary}

## Chapters

${sectionOverview}

## Details
${sectionsMarkdown}

## Links
${relatedLinksMarkdown ? `\n${relatedLinksMarkdown}` : ""}

${otherLinksMarkdown ? `\n${otherLinksMarkdown}` : ""}
`;
}

/**
 * Saves the digest to an organized file structure (CLI only)
 * Creates: outputs/{channel-slug}/{title-slug}.md
 *
 * @param content - Markdown content to save
 * @param metadata - Video metadata for file path generation
 * @returns Full path to the saved file
 */
export async function saveDigestToFile(
  content: string,
  metadata: VideoMetadata
): Promise<string> {
  // Create slugs for directory and filename
  const channelSlug = createSlug(metadata.channelTitle);
  const titleSlug = createSlug(metadata.title);

  // Build output path
  const outputDir = path.join(process.cwd(), "outputs", channelSlug);
  const outputPath = path.join(outputDir, `${titleSlug}.md`);

  // Ensure directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Write file
  fs.writeFileSync(outputPath, content, "utf-8");

  return outputPath;
}
