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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  let llmApiKey: string;
  let youtubeApiKey: string;
  try {
    llmApiKey = requireEnv("OPENROUTER_API_KEY");
    youtubeApiKey = requireEnv("YOUTUBE_API_KEY");
  } catch (err) {
    console.error("[intake] env-misconfig:", err);
    return NextResponse.json({ error: "server-misconfigured" }, { status: 500 });
  }

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

  const origin = req.nextUrl.origin;

  const deps: IntakeDeps = {
    fetchVideoMetadata: (videoId) => fetchVideoMetadata(videoId, youtubeApiKey),
    generateBrief: ({ transcript, metadata, apiKey, augmentedTranscript }) =>
      generateBrief({
        transcript,
        metadata,
        apiKey,
        ...(augmentedTranscript ? { augmentedTranscript } : {}),
      }),
    saveSubmission: async ({ userId, metadata, brief, briefMetrics, frames }) => {
      // When frames are included or attempted-failed, the CLI ships the
      // FramesMetrics blob in the submission. Persist it verbatim so iteration
      // on cue/weave/prompt heuristics has token + per-phase telemetry to read.
      const framesMetrics = frames.kind === "not-requested" ? null : frames.metrics;
      const dbBrief = await saveBrief(
        userId,
        metadata,
        brief,
        false,
        null,
        briefMetrics,
        frames.kind,
        framesMetrics,
      );
      return { briefId: dbBrief.id };
    },
    llmApiKey,
    buildBriefUrl: (briefId) => `${origin}/brief/${briefId}`,
  };

  const result = await handleIntake(parsed.data, { userId: verified.userId }, deps);

  if (result.kind === "transient") {
    console.error(
      `[intake] transient failure for user ${verified.userId}:`,
      result.cause,
      result.message,
    );
    return NextResponse.json({ error: "transient" }, { status: 503 });
  }
  return NextResponse.json(result.response);
}
