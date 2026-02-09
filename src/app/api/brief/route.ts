import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { extractVideoId } from "@/lib/parser";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateBrief } from "@/lib/summarize";
import { extractChapters } from "@/lib/chapters";
import { isEmailAllowed } from "@/lib/access";
import {
  saveBrief,
  getBriefByVideoId,
  updateBrief,
  findGlobalBriefByVideoId,
  copyBriefForUser,
} from "@/lib/db";
import type { DbBrief } from "@/lib/types";

type Step = "cached" | "metadata" | "transcript" | "analyzing" | "saving" | "complete" | "error";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isStale(brief: DbBrief): boolean {
  const timestamp = brief.updatedAt || brief.createdAt;
  const age = Date.now() - new Date(timestamp).getTime();
  return age > ONE_DAY_MS;
}

function createEvent(step: Step, message: string, data?: unknown) {
  console.log(`[BRIEF] Step: ${step} | Message: ${message}`);
  return `data: ${JSON.stringify({ step, message, data })}\n\n`;
}

function formatBriefResponse(dbBrief: DbBrief) {
  return {
    metadata: {
      videoId: dbBrief.videoId,
      title: dbBrief.title,
      channelTitle: dbBrief.channelName,
      duration: dbBrief.duration,
      publishedAt: dbBrief.publishedAt,
      thumbnailUrl: dbBrief.thumbnailUrl,
    },
    brief: {
      summary: dbBrief.summary,
      sections: dbBrief.sections,
      relatedLinks: dbBrief.relatedLinks,
      otherLinks: dbBrief.otherLinks,
    },
    briefId: dbBrief.id,
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
          "Brief generation is currently limited to approved users. Bring Your Own Key (BYOK) support is coming soon!",
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

        // Step 1: Check if user already has this video's brief
        console.log(`[BRIEF] Checking DB for user's cached brief, userId: ${userId}, videoId: ${videoId}`);
        const userBrief = await getBriefByVideoId(userId, videoId);
        console.log(`[BRIEF] User brief result: found=${!!userBrief}, stale=${userBrief ? isStale(userBrief) : 'N/A'}`);

        if (userBrief && !isStale(userBrief)) {
          // Return user's cached brief
          controller.enqueue(encoder.encode(createEvent("cached", "Found cached brief")));
          controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatBriefResponse(userBrief))));
          controller.close();
          return;
        }

        // Step 2: Check global cache for any brief of this video
        console.log(`[BRIEF] Checking global cache for videoId: ${videoId}`);
        const globalBrief = await findGlobalBriefByVideoId(videoId);
        console.log(`[BRIEF] Global cache result: found=${!!globalBrief}, stale=${globalBrief ? isStale(globalBrief) : 'N/A'}`);

        if (globalBrief && !isStale(globalBrief)) {
          // Copy global brief to user
          controller.enqueue(encoder.encode(createEvent("cached", "Found cached brief")));
          controller.enqueue(encoder.encode(createEvent("saving", "Adding to your library...")));
          const copiedBrief = await copyBriefForUser(globalBrief, userId);
          console.log(`[BRIEF] Copied global brief to user`);
          controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatBriefResponse(copiedBrief))));
          controller.close();
          return;
        }

        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const youtubeApiKey = process.env.YOUTUBE_API_KEY;

        // Log environment check (not values, just presence)
        console.log(`[BRIEF] Env check: ANTHROPIC_API_KEY=${!!anthropicApiKey}, YOUTUBE_API_KEY=${!!youtubeApiKey}`);

        if (!anthropicApiKey || !youtubeApiKey) {
          controller.enqueue(encoder.encode(createEvent("error", "API keys not configured")));
          controller.close();
          return;
        }

        // Step 3: Fetch metadata
        controller.enqueue(encoder.encode(createEvent("metadata", "Fetching video info...")));
        console.log(`[BRIEF] Fetching metadata for videoId: ${videoId}`);
        const metadata = await fetchVideoMetadata(videoId, youtubeApiKey);
        console.log(`[BRIEF] Metadata fetched successfully: ${metadata.title}`);

        // Extract chapters from description
        const chapters = extractChapters(metadata.description, metadata.duration);
        console.log(`[BRIEF] Chapters extracted: ${chapters ? chapters.length : 'none'}`);

        // Step 4: Fetch transcript
        controller.enqueue(encoder.encode(createEvent("transcript", "Extracting transcript...")));
        console.log(`[BRIEF] Starting transcript fetch for videoId: ${videoId}`);
        const transcript = await fetchTranscript(videoId);
        console.log(`[BRIEF] Transcript fetched successfully: ${transcript.length} entries`);

        // Step 5: Generate brief
        controller.enqueue(encoder.encode(createEvent("analyzing", "Analyzing content...")));
        console.log(`[BRIEF] Starting brief generation`);
        const brief = await generateBrief(transcript, metadata, anthropicApiKey, chapters);
        console.log(`[BRIEF] Brief generated successfully`);

        // Step 6: Save or update brief
        controller.enqueue(encoder.encode(createEvent("saving", "Saving brief...")));
        const hasCreatorChapters = chapters !== null && chapters.length > 0;
        console.log(`[BRIEF] Saving to database, userBrief: ${!!userBrief}, hasCreatorChapters: ${hasCreatorChapters}`);
        let savedBrief: DbBrief;
        if (userBrief) {
          // Update stale brief
          savedBrief = await updateBrief(userId, userBrief.id, metadata, brief, hasCreatorChapters);
          console.log(`[BRIEF] Updated existing brief`);
        } else {
          // Save new brief
          savedBrief = await saveBrief(userId, metadata, brief, hasCreatorChapters);
          console.log(`[BRIEF] Saved new brief`);
        }

        // Complete
        console.log(`[BRIEF] Process complete!`);
        controller.enqueue(encoder.encode(createEvent("complete", "Done!", formatBriefResponse(savedBrief))));
        controller.close();
      } catch (error) {
        console.error(`[BRIEF] ERROR:`, error);
        const message = error instanceof Error ? error.message : "Failed to create brief";
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
