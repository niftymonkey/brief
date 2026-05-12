import { NextResponse, type NextRequest } from "next/server";
import { TranscriptSubmissionSchema } from "@brief/core";
import { extractBearer } from "@/lib/cli-auth";
import { createWorkosTokenVerifier } from "@/lib/cli-auth-workos";
import { handleIntake, type IntakeDeps } from "@/lib/cli-intake";
import { fetchVideoMetadata } from "@/lib/metadata";
import { generateBrief } from "@/lib/summarize";
import { saveBrief } from "@/lib/db";

function unauthorized(reason: string) {
  return NextResponse.json(
    { error: reason },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="brief"' } },
  );
}

export async function POST(req: NextRequest) {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorized("missing-auth");

  const verifier = createWorkosTokenVerifier();
  const verified = await verifier.verify(token);
  if (verified.kind !== "ok") return unauthorized(verified.kind);

  const rawBody = await req.json().catch(() => null);
  if (rawBody === null) {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = TranscriptSubmissionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid-body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const llmApiKey = process.env.OPENROUTER_API_KEY ?? "";
  const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? "";
  const origin = req.nextUrl.origin;

  const deps: IntakeDeps = {
    fetchVideoMetadata: (videoId) => fetchVideoMetadata(videoId, youtubeApiKey),
    generateBrief: (transcript, metadata, key) => generateBrief(transcript, metadata, key),
    // TODO(chunk-8): persist frames discriminator + frames_status. v1 writes 'not-requested' default via saveBrief.
    saveSubmission: async ({ userId, metadata, brief, briefMetrics }) => {
      const dbBrief = await saveBrief(userId, metadata, brief, false, null, briefMetrics);
      return { briefId: dbBrief.id };
    },
    llmApiKey,
    buildBriefUrl: (briefId) => `${origin}/brief/${briefId}`,
  };

  const result = await handleIntake(parsed.data, { userId: verified.userId }, deps);

  if (result.kind === "transient") {
    return NextResponse.json(
      { error: "transient", cause: result.cause, message: result.message },
      { status: 503 },
    );
  }
  return NextResponse.json(result.response);
}
