import { z } from "zod";

export const SCHEMA_VERSION = "2.0.0" as const;

export const TranscriptEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("speech"),
    offsetSec: z.number(),
    durationSec: z.number(),
    text: z.string(),
    lang: z.string().optional(),
  }),
  z.object({
    kind: z.literal("visual"),
    offsetSec: z.number(),
    mode: z.enum(["verbatim", "summary"]),
    text: z.string(),
  }),
]);

export const VideoMetadataSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelTitle: z.string(),
  channelId: z.string(),
  duration: z.string(),
  publishedAt: z.string(),
  description: z.string(),
  pinnedComment: z.string().optional(),
});

export const FramesMetricsSchema = z.object({
  videoDurationSec: z.number(),
  candidatesGenerated: z.number(),
  candidatesAfterDedup: z.number(),
  classifierYes: z.number(),
  classifierNo: z.number(),
  visionCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  classifierModel: z.string(),
  visionModel: z.string(),
  wallClockMs: z.number(),
  costSource: z.literal("cli-reported"),
});

export const TranscriptSubmissionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  videoId: z.string(),
  metadata: VideoMetadataSchema,
  transcript: z.array(TranscriptEntrySchema),
  frames: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not-requested") }),
    z.object({ kind: z.literal("included"), metrics: FramesMetricsSchema }),
    z.object({
      kind: z.literal("attempted-failed"),
      reason: z.string(),
      phase: z.string(),
      metrics: FramesMetricsSchema,
    }),
  ]),
});

export type TranscriptSubmission = z.infer<typeof TranscriptSubmissionSchema>;
