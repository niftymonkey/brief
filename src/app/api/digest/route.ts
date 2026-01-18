import { NextRequest } from "next/server";
import { extractVideoId } from "@/lib/parser";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateDigest } from "@/lib/summarize";
import { saveDigest, getDigestByVideoId, updateDigest } from "@/lib/db";
import type { DbDigest } from "@/lib/types";

type Step = "cached" | "metadata" | "transcript" | "analyzing" | "saving" | "complete" | "error";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isStale(digest: DbDigest): boolean {
  const timestamp = digest.updatedAt || digest.createdAt;
  const age = Date.now() - new Date(timestamp).getTime();
  return age > ONE_DAY_MS;
}

function createEvent(step: Step, message: string, data?: unknown) {
  console.log(`[DIGEST] Step: ${step} | Message: ${message}`);
  return `data: ${JSON.stringify({ step, message, data })}\n\n`;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { url } = await request.json();

        if (!url) {
          controller.enqueue(encoder.encode(createEvent("error", "URL is required")));
          controller.close();
          return;
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
          controller.enqueue(encoder.encode(createEvent("error", "Invalid YouTube URL")));
          controller.close();
          return;
        }

        // Check for existing cached digest
        console.log(`[DIGEST] Checking DB for cached digest, videoId: ${videoId}`);
        const existingDigest = await getDigestByVideoId(videoId);
        console.log(`[DIGEST] DB result: found=${!!existingDigest}, stale=${existingDigest ? isStale(existingDigest) : 'N/A'}`);

        if (existingDigest && !isStale(existingDigest)) {
          // Return cached digest immediately
          controller.enqueue(encoder.encode(createEvent("cached", "Found cached digest")));
          controller.enqueue(encoder.encode(createEvent("complete", "Done!", {
            metadata: {
              videoId: existingDigest.videoId,
              title: existingDigest.title,
              channelTitle: existingDigest.channelName,
              duration: existingDigest.duration,
              publishedAt: existingDigest.publishedAt,
              thumbnailUrl: existingDigest.thumbnailUrl,
            },
            digest: {
              summary: existingDigest.summary,
              sections: existingDigest.sections,
              tangents: existingDigest.tangents,
              relatedLinks: existingDigest.relatedLinks,
              otherLinks: existingDigest.otherLinks,
            },
          })));
          controller.close();
          return;
        }

        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const youtubeApiKey = process.env.YOUTUBE_API_KEY;

        // Log environment check (not values, just presence)
        console.log(`[DIGEST] Env check: ANTHROPIC_API_KEY=${!!anthropicApiKey}, YOUTUBE_API_KEY=${!!youtubeApiKey}`);

        if (!anthropicApiKey || !youtubeApiKey) {
          controller.enqueue(encoder.encode(createEvent("error", "API keys not configured")));
          controller.close();
          return;
        }

        // Step 1: Fetch metadata
        controller.enqueue(encoder.encode(createEvent("metadata", "Fetching video info...")));
        console.log(`[DIGEST] Fetching metadata for videoId: ${videoId}`);
        const metadata = await fetchVideoMetadata(videoId, youtubeApiKey);
        console.log(`[DIGEST] Metadata fetched successfully: ${metadata.title}`);

        // Step 2: Fetch transcript
        controller.enqueue(encoder.encode(createEvent("transcript", "Extracting transcript...")));
        console.log(`[DIGEST] Starting transcript fetch for videoId: ${videoId}`);
        const transcript = await fetchTranscript(videoId);
        console.log(`[DIGEST] Transcript fetched successfully: ${transcript.length} entries`);

        // Step 3: Generate digest
        controller.enqueue(encoder.encode(createEvent("analyzing", "Analyzing content...")));
        console.log(`[DIGEST] Starting digest generation`);
        const digest = await generateDigest(transcript, metadata, anthropicApiKey);
        console.log(`[DIGEST] Digest generated successfully`);

        // Step 4: Save or update digest
        controller.enqueue(encoder.encode(createEvent("saving", "Saving digest...")));
        console.log(`[DIGEST] Saving to database, existingDigest: ${!!existingDigest}`);
        if (existingDigest) {
          // Update stale digest
          await updateDigest(videoId, metadata, digest);
          console.log(`[DIGEST] Updated existing digest`);
        } else {
          // Save new digest
          await saveDigest(metadata, digest);
          console.log(`[DIGEST] Saved new digest`);
        }

        // Complete
        console.log(`[DIGEST] Process complete!`);
        controller.enqueue(encoder.encode(createEvent("complete", "Done!", { metadata, digest })));
        controller.close();
      } catch (error) {
        console.error(`[DIGEST] ERROR:`, error);
        const message = error instanceof Error ? error.message : "Failed to create digest";
        controller.enqueue(encoder.encode(createEvent("error", message)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
