import type { z } from "zod";
import {
  TranscriptEntrySchema,
  type IntakeResponse,
  type TranscriptSubmission,
} from "@brief/core";
import type {
  BriefMetrics,
  StructuredBrief,
  TranscriptEntry as WebTranscriptEntry,
  VideoMetadata,
} from "./types";

type SubmissionTranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export interface IntakeContext {
  userId: string;
}

export interface SaveSubmissionArgs {
  userId: string;
  videoId: string;
  metadata: VideoMetadata;
  transcript: SubmissionTranscriptEntry[];
  brief: StructuredBrief;
  briefMetrics: BriefMetrics;
  frames: TranscriptSubmission["frames"];
}

export interface IntakeDeps {
  generateBrief(
    transcript: WebTranscriptEntry[],
    metadata: VideoMetadata,
    apiKey: string,
  ): Promise<{ brief: StructuredBrief; metrics: BriefMetrics }>;
  saveSubmission(args: SaveSubmissionArgs): Promise<{ briefId: string }>;
  llmApiKey: string;
  buildBriefUrl(briefId: string): string;
}

export type IntakeResult =
  | { kind: "ok"; response: IntakeResponse }
  | { kind: "transient"; cause: string; message: string };

export function toFlatSpeechEntries(entries: SubmissionTranscriptEntry[]): WebTranscriptEntry[] {
  const out: WebTranscriptEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "speech") continue;
    const flat: WebTranscriptEntry = {
      text: entry.text,
      offset: entry.offsetSec,
      duration: entry.durationSec,
    };
    if (entry.lang !== undefined) flat.lang = entry.lang;
    out.push(flat);
  }
  return out;
}

export async function handleIntake(
  submission: TranscriptSubmission,
  ctx: IntakeContext,
  deps: IntakeDeps,
): Promise<IntakeResult> {
  const flatTranscript = toFlatSpeechEntries(submission.transcript);

  let briefResult: { brief: StructuredBrief; metrics: BriefMetrics };
  try {
    briefResult = await deps.generateBrief(flatTranscript, submission.metadata, deps.llmApiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "transient", cause: message, message: `Failed to generate brief: ${message}` };
  }

  let saved: { briefId: string };
  try {
    saved = await deps.saveSubmission({
      userId: ctx.userId,
      videoId: submission.videoId,
      metadata: submission.metadata,
      transcript: submission.transcript,
      brief: briefResult.brief,
      briefMetrics: briefResult.metrics,
      frames: submission.frames,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "transient", cause: message, message: `Failed to persist submission: ${message}` };
  }

  return {
    kind: "ok",
    response: {
      schemaVersion: submission.schemaVersion,
      briefId: saved.briefId,
      briefUrl: deps.buildBriefUrl(saved.briefId),
      brief: briefResult.brief,
      metadata: submission.metadata,
    },
  };
}
