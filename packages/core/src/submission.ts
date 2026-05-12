import { z } from "zod";

// Bumped to 2.1.0 alongside #87 Phase 5: FramesMetricsSchema added required
// fields (visionVerbatim, visionSummary, phasesMs), and frames.included gained
// a required `transcript: string`. Pre-2.1.0 clients submitting the old shape
// get a clean schema-mismatch (HTTP 409) from the intake endpoint and the
// `serverAccepts` array tells them which version to upgrade to.
export const SCHEMA_VERSION = "2.1.0" as const;

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
  visionVerbatim: z.number(),
  visionSummary: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  classifierModel: z.string(),
  visionModel: z.string(),
  wallClockMs: z.number(),
  // String keys (intentionally not enum-constrained at the wire boundary) so
  // a Phase 5+ producer can add new phases without breaking older consumers.
  // The TypeScript shape is constrained to FramesPhase keys via the producer.
  phasesMs: z.record(z.string(), z.number()),
  costSource: z.literal("cli-reported"),
});

export const TranscriptSubmissionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  videoId: z.string(),
  transcript: z.array(TranscriptEntrySchema),
  frames: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not-requested") }),
    z.object({
      kind: z.literal("included"),
      transcript: z.string(),
      metrics: FramesMetricsSchema,
    }),
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

export const CliConfigResponseSchema = z.object({
  workosClientId: z.string(),
});

export type BriefBody = z.infer<typeof BriefBodySchema>;
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
export type WhoamiResponse = z.infer<typeof WhoamiResponseSchema>;
export type CliConfigResponse = z.infer<typeof CliConfigResponseSchema>;
