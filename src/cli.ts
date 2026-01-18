#!/usr/bin/env tsx
import { config } from "dotenv";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import {
  extractVideoId,
  fetchVideoMetadata,
  fetchTranscript,
  generateDigest,
  formatMarkdown,
  saveDigestToFile,
} from "./lib/index.js";

// Configure marked to use terminal renderer
// @ts-expect-error - types are outdated but runtime works
marked.use(markedTerminal());

// Load environment variables
config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);

  // Validate arguments
  if (args.length === 0) {
    console.error("❌ Error: No YouTube URL provided\n");
    console.error("Usage: pnpm digest <youtube-url>\n");
    console.error(
      "Example: pnpm digest https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    process.exit(1);
  }

  const url = args[0];

  // Validate API keys
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;

  if (!anthropicApiKey) {
    console.error("❌ Error: ANTHROPIC_API_KEY not found in .env\n");
    console.error("To fix:");
    console.error("  1. Copy .env.example to .env");
    console.error(
      "  2. Add your Anthropic API key from https://console.anthropic.com/"
    );
    process.exit(1);
  }

  if (!youtubeApiKey) {
    console.error("❌ Error: YOUTUBE_API_KEY not found in .env\n");
    console.error("To fix:");
    console.error("  1. Copy .env.example to .env");
    console.error(
      "  2. Add your YouTube Data API key from https://console.cloud.google.com/"
    );
    process.exit(1);
  }

  try {
    // Step 1: Parse URL
    console.log("🔍 Parsing YouTube URL...");
    const videoId = extractVideoId(url);

    if (!videoId) {
      throw new Error(
        "Invalid YouTube URL format. Supported formats:\n" +
          "  - https://www.youtube.com/watch?v=VIDEO_ID\n" +
          "  - https://youtu.be/VIDEO_ID\n" +
          "  - https://m.youtube.com/watch?v=VIDEO_ID"
      );
    }

    console.log(`✅ Video ID: ${videoId}\n`);

    // Step 2: Fetch metadata and transcript in parallel
    console.log("📥 Fetching video metadata...");
    const metadataPromise = fetchVideoMetadata(videoId, youtubeApiKey);

    console.log("📜 Fetching transcript...");
    const transcriptPromise = fetchTranscript(videoId);

    const [metadata, transcript] = await Promise.all([
      metadataPromise,
      transcriptPromise,
    ]);

    console.log(`✅ Title: "${metadata.title}"`);
    console.log(`✅ Channel: ${metadata.channelTitle}`);
    console.log(`✅ Retrieved ${transcript.length} caption entries\n`);

    // Step 3: Generate digest with Claude
    console.log("🤖 Generating digest with Claude...");
    const digest = await generateDigest(transcript, metadata, anthropicApiKey);
    console.log("✅ Digest generated\n");

    // Step 4: Format markdown
    const markdown = formatMarkdown(metadata, digest);

    // Step 5: Save to file
    const outputPath = await saveDigestToFile(markdown, metadata);
    console.log(`💾 Saving to: ${outputPath}`);
    console.log("✅ File saved successfully\n");

    // Step 6: Display to console (rendered markdown)
    console.log("=".repeat(80));
    console.log(marked.parse(markdown));
    console.log("=".repeat(80));

    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
    process.exit(1);
  }
}

main();
