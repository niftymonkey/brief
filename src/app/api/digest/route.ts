import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { extractVideoId } from "@/lib/parser";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateDigest } from "@/lib/summarize";
import { extractChapters } from "@/lib/chapters";
import { isEmailAllowed } from "@/lib/access";
import {
  saveDigest,
  getDigestByVideoId,
  updateDigest,
  findGlobalDigestByVideoId,
  copyDigestForUser,
} from "@/lib/db";
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

function formatDigestResponse(dbDigest: DbDigest) {
  return {
    metadata: {
      videoId: dbDigest.videoId,
      title: dbDigest.title,
      channelTitle: dbDigest.channelName,
      duration: dbDigest.duration,
      publishedAt: dbDigest.publishedAt,
      thumbnailUrl: dbDigest.thumbnailUrl,
    },
    digest: {
      summary: dbDigest.summary,
      sections: dbDigest.sections,
      relatedLinks: dbDigest.relatedLinks,
      otherLinks: dbDigest.otherLinks,
    },
    digestId: dbDigest.id,
  };
}

export async function POST(request: NextRequest) {
  const { user } = await withAuth();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isEmailAllowed(user.email)) {
    return new Response(
      JSON.stringify({
        error: "Access restricted",
        message:
          "Digest generation is currently limited to approved users. Bring Your Own Key (BYOK) support is coming soon!",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const userId = user.id;
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

        // Step 1: Check if user already has this video's digest
        console.log(`[DIGEST] Checking DB for user's cached digest, userId: ${userId}, videoId: ${videoId}`);
        const userDigest = await getDigestByVideoId(userId, videoId);
        console.log(`[DIGEST] User digest result: found=${!!userDigest}, stale=${userDigest ? isStale(userDigest) : 'N/A'}`);

        if (userDigest && !isStale(userDigest)) {
          // Return user's cached digest
          controller.enqueue(encoder.encode(createEvent("cached", "Found cached digest")));
          controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatDigestResponse(userDigest))));
          controller.close();
          return;
        }

        // Step 2: Check global cache for any digest of this video
        console.log(`[DIGEST] Checking global cache for videoId: ${videoId}`);
        const globalDigest = await findGlobalDigestByVideoId(videoId);
        console.log(`[DIGEST] Global cache result: found=${!!globalDigest}, stale=${globalDigest ? isStale(globalDigest) : 'N/A'}`);

        if (globalDigest && !isStale(globalDigest)) {
          // Copy global digest to user
          controller.enqueue(encoder.encode(createEvent("cached", "Found cached digest")));
          controller.enqueue(encoder.encode(createEvent("saving", "Adding to your library...")));
          const copiedDigest = await copyDigestForUser(globalDigest, userId);
          console.log(`[DIGEST] Copied global digest to user`);
          controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatDigestResponse(copiedDigest))));
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

        // Step 3: Fetch metadata
        controller.enqueue(encoder.encode(createEvent("metadata", "Fetching video info...")));
        console.log(`[DIGEST] Fetching metadata for videoId: ${videoId}`);
        const metadata = await fetchVideoMetadata(videoId, youtubeApiKey);
        console.log(`[DIGEST] Metadata fetched successfully: ${metadata.title}`);

        // Extract chapters from description
        const chapters = extractChapters(metadata.description, metadata.duration);
        console.log(`[DIGEST] Chapters extracted: ${chapters ? chapters.length : 'none'}`);

        // Step 4: Fetch transcript
        controller.enqueue(encoder.encode(createEvent("transcript", "Extracting transcript...")));
        console.log(`[DIGEST] Starting transcript fetch for videoId: ${videoId}`);
        const transcript = await fetchTranscript(videoId);
        console.log(`[DIGEST] Transcript fetched successfully: ${transcript.length} entries`);

        // Step 5: Generate digest
        controller.enqueue(encoder.encode(createEvent("analyzing", "Analyzing content...")));
        console.log(`[DIGEST] Starting digest generation`);
        const digest = await generateDigest(transcript, metadata, anthropicApiKey, chapters);
        console.log(`[DIGEST] Digest generated successfully`);

        // Step 6: Save or update digest
        controller.enqueue(encoder.encode(createEvent("saving", "Saving digest...")));
        const hasCreatorChapters = chapters !== null && chapters.length > 0;
        console.log(`[DIGEST] Saving to database, userDigest: ${!!userDigest}, hasCreatorChapters: ${hasCreatorChapters}`);
        let savedDigest: DbDigest;
        if (userDigest) {
          // Update stale digest
          savedDigest = await updateDigest(userId, userDigest.id, metadata, digest, hasCreatorChapters);
          console.log(`[DIGEST] Updated existing digest`);
        } else {
          // Save new digest
          savedDigest = await saveDigest(userId, metadata, digest, hasCreatorChapters);
          console.log(`[DIGEST] Saved new digest`);
        }

        // Complete
        console.log(`[DIGEST] Process complete!`);
        controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatDigestResponse(savedDigest))));
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
