import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { extractVideoId } from "@/lib/parser";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateBrief } from "@/lib/summarize";
import { extractChapters } from "@/lib/chapters";
import { isEmailAllowed } from "@/lib/access";
import {
  getBriefByVideoId,
  getPendingBriefByVideoId,
  findGlobalBriefByVideoId,
  copyBriefForUser,
  createPendingBrief,
  updateBriefStatus,
  completePendingBrief,
} from "@/lib/db";

export const maxDuration = 120;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isStale(brief: { updatedAt: Date; createdAt: Date }): boolean {
  const timestamp = brief.updatedAt || brief.createdAt;
  const age = Date.now() - new Date(timestamp).getTime();
  return age > ONE_DAY_MS;
}

export async function POST(request: NextRequest) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailAllowed(user.email)) {
    return NextResponse.json(
      { error: "Access restricted" },
      { status: 403 }
    );
  }

  const userId = user.id;

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  // Check user cache
  const userBrief = await getBriefByVideoId(userId, videoId);
  if (userBrief && !isStale(userBrief)) {
    return NextResponse.json(
      { jobId: userBrief.id, status: "completed", briefId: userBrief.id },
      { status: 200 }
    );
  }

  // Check if already queued/processing for this user
  const pendingBrief = await getPendingBriefByVideoId(userId, videoId);
  if (pendingBrief) {
    return NextResponse.json(
      { jobId: pendingBrief.id, status: pendingBrief.status },
      { status: 200 }
    );
  }

  // Check global cache
  const globalBrief = await findGlobalBriefByVideoId(videoId);
  if (globalBrief && !isStale(globalBrief)) {
    const copiedBrief = await copyBriefForUser(globalBrief, userId);
    return NextResponse.json(
      { jobId: copiedBrief.id, status: "completed", briefId: copiedBrief.id },
      { status: 200 }
    );
  }

  // Create pending brief and process in background
  const jobId = await createPendingBrief(userId, videoId);

  after(async () => {
    try {
      await updateBriefStatus(jobId, "processing");

      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      const youtubeApiKey = process.env.YOUTUBE_API_KEY;

      if (!anthropicApiKey || !youtubeApiKey) {
        await updateBriefStatus(jobId, "failed", "API keys not configured");
        return;
      }

      const metadata = await fetchVideoMetadata(videoId, youtubeApiKey);
      const chapters = extractChapters(metadata.description, metadata.duration);
      const transcript = await fetchTranscript(videoId);
      const brief = await generateBrief(transcript, metadata, anthropicApiKey, chapters);
      const hasCreatorChapters = chapters !== null && chapters.length > 0;

      await completePendingBrief(userId, jobId, metadata, brief, hasCreatorChapters);
      console.log(`[BRIEFS] Async brief completed: ${jobId}`);
    } catch (error) {
      console.error(`[BRIEFS] Async brief failed: ${jobId}`, error);
      const message = error instanceof Error ? error.message : "Failed to create brief";
      try {
        await updateBriefStatus(jobId, "failed", message);
      } catch (statusError) {
        console.error(`[BRIEFS] Failed to update status to failed: ${jobId}`, statusError);
      }
    }
  });

  return NextResponse.json(
    { jobId, status: "queued" },
    { status: 202 }
  );
}
