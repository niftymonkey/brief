import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  TranscriptEntrySchema,
  VideoMetadataSchema,
  FramesMetricsSchema,
  TranscriptSubmissionSchema,
  type TranscriptSubmission,
} from "./submission";

const validSpeech = {
  kind: "speech",
  offsetSec: 0,
  durationSec: 5.2,
  text: "Hello world",
};

const validVisual = {
  kind: "visual",
  offsetSec: 30,
  mode: "verbatim",
  text: "Pricing: $19/mo",
};

const validMetadata = {
  videoId: "abc123XYZAB",
  title: "Test video",
  channelTitle: "Test channel",
  channelId: "UC_abc",
  duration: "PT3M30S",
  publishedAt: "2024-01-01T00:00:00Z",
  description: "A test description",
};

const validMetrics = {
  videoDurationSec: 210,
  candidatesGenerated: 80,
  candidatesAfterDedup: 50,
  classifierYes: 15,
  classifierNo: 35,
  visionCalls: 15,
  inputTokens: 27000,
  outputTokens: 4000,
  classifierModel: "openai/gpt-5.4-nano",
  visionModel: "openai/gpt-5.5",
  wallClockMs: 250000,
  costSource: "cli-reported",
};

describe("SCHEMA_VERSION", () => {
  it("is the v2 literal", () => {
    expect(SCHEMA_VERSION).toBe("2.0.0");
  });
});

describe("TranscriptEntrySchema", () => {
  it("accepts a speech entry", () => {
    const result = TranscriptEntrySchema.safeParse(validSpeech);
    expect(result.success).toBe(true);
  });

  it("accepts a visual entry with verbatim mode", () => {
    const result = TranscriptEntrySchema.safeParse(validVisual);
    expect(result.success).toBe(true);
  });

  it("accepts a visual entry with summary mode", () => {
    const result = TranscriptEntrySchema.safeParse({
      ...validVisual,
      mode: "summary",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a speech entry with optional lang", () => {
    const result = TranscriptEntrySchema.safeParse({
      ...validSpeech,
      lang: "en",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry without kind", () => {
    const { kind: _kind, ...withoutKind } = validSpeech;
    const result = TranscriptEntrySchema.safeParse(withoutKind);
    expect(result.success).toBe(false);
  });

  it("rejects an entry with unknown kind", () => {
    const result = TranscriptEntrySchema.safeParse({
      ...validSpeech,
      kind: "rumor",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a speech entry missing required offsetSec", () => {
    const { offsetSec: _o, ...withoutOffset } = validSpeech;
    const result = TranscriptEntrySchema.safeParse(withoutOffset);
    expect(result.success).toBe(false);
  });

  it("rejects a visual entry with invalid mode", () => {
    const result = TranscriptEntrySchema.safeParse({
      ...validVisual,
      mode: "guesswork",
    });
    expect(result.success).toBe(false);
  });
});

describe("VideoMetadataSchema", () => {
  it("accepts complete metadata", () => {
    const result = VideoMetadataSchema.safeParse(validMetadata);
    expect(result.success).toBe(true);
  });

  it("accepts metadata with pinnedComment", () => {
    const result = VideoMetadataSchema.safeParse({
      ...validMetadata,
      pinnedComment: "Read this first",
    });
    expect(result.success).toBe(true);
  });

  it("rejects metadata missing videoId", () => {
    const { videoId: _v, ...withoutId } = validMetadata;
    const result = VideoMetadataSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it("rejects metadata missing duration", () => {
    const { duration: _d, ...withoutDuration } = validMetadata;
    const result = VideoMetadataSchema.safeParse(withoutDuration);
    expect(result.success).toBe(false);
  });
});

describe("FramesMetricsSchema", () => {
  it("accepts metrics with costSource cli-reported", () => {
    const result = FramesMetricsSchema.safeParse(validMetrics);
    expect(result.success).toBe(true);
  });

  it("rejects metrics with costSource other than cli-reported", () => {
    const result = FramesMetricsSchema.safeParse({
      ...validMetrics,
      costSource: "server-issued",
    });
    expect(result.success).toBe(false);
  });

  it("rejects metrics missing costSource", () => {
    const { costSource: _c, ...withoutCostSource } = validMetrics;
    const result = FramesMetricsSchema.safeParse(withoutCostSource);
    expect(result.success).toBe(false);
  });

  it("rejects metrics missing required fields", () => {
    const result = FramesMetricsSchema.safeParse({ costSource: "cli-reported" });
    expect(result.success).toBe(false);
  });
});

describe("TranscriptSubmissionSchema", () => {
  const validTranscriptOnly = {
    schemaVersion: "2.0.0",
    videoId: "abc123XYZAB",
    transcript: [validSpeech],
    frames: { kind: "not-requested" },
  };

  it("accepts a transcript-only submission", () => {
    const result = TranscriptSubmissionSchema.safeParse(validTranscriptOnly);
    expect(result.success).toBe(true);
  });

  it("accepts an augmented submission with frames.kind included", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      transcript: [validSpeech, validVisual],
      frames: { kind: "included", metrics: validMetrics },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a submission with frames.kind attempted-failed", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      frames: {
        kind: "attempted-failed",
        reason: "download-blocked-bot-detection",
        phase: "download",
        metrics: validMetrics,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects wrong schemaVersion literal", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      schemaVersion: "1.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown frames.kind", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      frames: { kind: "shipped-it" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects frames.kind=included without metrics", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      frames: { kind: "included" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects frames.kind=attempted-failed without reason/phase", () => {
    const result = TranscriptSubmissionSchema.safeParse({
      ...validTranscriptOnly,
      frames: { kind: "attempted-failed", metrics: validMetrics },
    });
    expect(result.success).toBe(false);
  });

  it("inferred type matches expected discriminated-union shape", () => {
    const submission: TranscriptSubmission = {
      schemaVersion: "2.0.0",
      videoId: "abc",
      transcript: [{ kind: "speech", offsetSec: 0, durationSec: 1, text: "x" }],
      frames: { kind: "not-requested" },
    };
    expect(submission.schemaVersion).toBe("2.0.0");
  });
});
