import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateBrief } from "@/lib/summarize";
import { extractChapters } from "@/lib/chapters";
import { isEmailAllowed } from "@/lib/access";
import { updateBrief, getBriefById } from "@/lib/db";

type Step = "metadata" | "transcript" | "analyzing" | "saving" | "complete" | "error";

function createEvent(step: Step, message: string) {
  return `data: ${JSON.stringify({ step, message })}\n\n`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    return NextResponse.json(
      {
        error: "Access restricted",
        message: "Brief regeneration is currently limited to approved users.",
      },
      { status: 403 }
    );
  }

  const { id } = await params;
  const { videoId } = await request.json();

  if (!id || !videoId) {
    return NextResponse.json({ error: "Brief ID and video ID are required" }, { status: 400 });
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;

  if (!anthropicApiKey || !youtubeApiKey) {
    return NextResponse.json({ error: "API keys not configured" }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Verify brief exists and belongs to user
        const existingBrief = await getBriefById(id, user.id);
        if (!existingBrief) {
          controller.enqueue(encoder.encode(createEvent("error", "Brief not found")));
          controller.close();
          return;
        }

        console.log(`[REGENERATE] Starting regeneration for brief ${id}, videoId: ${videoId}`);

        // Step 1: Fetch metadata
        controller.enqueue(encoder.encode(createEvent("metadata", "Fetching video info...")));
        const metadata = await fetchVideoMetadata(videoId, youtubeApiKey);
        console.log(`[REGENERATE] Metadata fetched: ${metadata.title}`);

        // Extract chapters from description
        const chapters = extractChapters(metadata.description, metadata.duration);
        console.log(`[REGENERATE] Chapters extracted: ${chapters ? chapters.length : 'none'}`);

        // Step 2: Fetch transcript
        controller.enqueue(encoder.encode(createEvent("transcript", "Extracting transcript...")));
        const transcript = await fetchTranscript(videoId);
        console.log(`[REGENERATE] Transcript fetched: ${transcript.length} entries`);

        // Step 3: Generate brief
        controller.enqueue(encoder.encode(createEvent("analyzing", "Analyzing content...")));
        const brief = await generateBrief(transcript, metadata, anthropicApiKey, chapters);
        console.log(`[REGENERATE] Brief generated`);

        // Step 4: Save
        controller.enqueue(encoder.encode(createEvent("saving", "Saving brief...")));
        const hasCreatorChapters = chapters !== null && chapters.length > 0;
        await updateBrief(user.id, id, metadata, brief, hasCreatorChapters);
        console.log(`[REGENERATE] Brief updated in database, hasCreatorChapters: ${hasCreatorChapters}`);

        // Complete
        controller.enqueue(encoder.encode(createEvent("complete", "Done!")));
        controller.close();
      } catch (error) {
        console.error("[REGENERATE] Error:", error);
        const message = error instanceof Error ? error.message : "Failed to regenerate brief";
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
