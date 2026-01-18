import { NextRequest, NextResponse } from "next/server";
import { extractVideoId } from "@/lib/parser";
import { fetchTranscript } from "@/lib/transcript";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateDigest } from "@/lib/summarize";
import { saveDigest, getDigestByVideoId } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    // Extract video ID
    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      );
    }

    // Get API keys from environment
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;

    if (!anthropicApiKey) {
      return NextResponse.json(
        { error: "Anthropic API key not configured" },
        { status: 500 }
      );
    }

    if (!youtubeApiKey) {
      return NextResponse.json(
        { error: "YouTube API key not configured" },
        { status: 500 }
      );
    }

    // Fetch metadata and transcript in parallel
    const [metadata, transcript] = await Promise.all([
      fetchVideoMetadata(videoId, youtubeApiKey),
      fetchTranscript(videoId),
    ]);

    // Generate AI digest
    const digest = await generateDigest(transcript, metadata, anthropicApiKey);

    // Save to database
    try {
      await saveDigest(metadata, digest);
    } catch (dbError) {
      // Log but don't fail the request if save fails
      console.error("Failed to save digest to database:", dbError);
    }

    return NextResponse.json({
      metadata,
      digest,
    });
  } catch (error) {
    console.error("Error creating digest:", error);

    const message =
      error instanceof Error ? error.message : "Failed to create digest";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
