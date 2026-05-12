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

export const LinkSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
});

export const KeyPointSchema = z.object({
  text: z.string(),
  timestamp: z.string(),
  isTangent: z.boolean().optional(),
});

export const ContentSectionSchema = z.object({
  title: z.string(),
  timestampStart: z.string(),
  timestampEnd: z.string(),
  keyPoints: z.array(z.union([KeyPointSchema, z.string()])),
});

export const BriefBodySchema = z.object({
  summary: z.string(),
  sections: z.array(ContentSectionSchema),
  relatedLinks: z.array(LinkSchema),
  otherLinks: z.array(LinkSchema),
});

export const IntakeResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  briefId: z.string(),
  briefUrl: z.string(),
  brief: BriefBodySchema,
  metadata: VideoMetadataSchema,
});

export const WhoamiResponseSchema = z.object({
  email: z.string(),
  userId: z.string(),
});

export const SchemaMismatchResponseSchema = z.object({
  error: z.literal("schema-mismatch"),
  serverAccepts: z.array(z.string()),
});

export type BriefBody = z.infer<typeof BriefBodySchema>;
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
export type WhoamiResponse = z.infer<typeof WhoamiResponseSchema>;
