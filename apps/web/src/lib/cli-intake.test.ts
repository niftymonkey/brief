import { describe, it, expect, vi } from "vitest";
import type { TranscriptSubmission } from "@brief/core";
import {
  handleIntake,
  toFlatSpeechEntries,
  type IntakeDeps,
} from "./cli-intake";

// Shared base fixtures: extend with `...spread` overrides per-test.

const sampleMetadata = {
  videoId: "abc123XYZAB",
  title: "Test video",
  channelTitle: "Test channel",
  channelId: "UC_abc",
  duration: "PT3M30S",
  publishedAt: "2024-01-01T00:00:00Z",
  description: "A test description",
};

const sampleSpeech = {
  kind: "speech" as const,
  offsetSec: 0,
  durationSec: 5.2,
  text: "Hello world",
};

const sampleVisual = {
  kind: "visual" as const,
  offsetSec: 30,
  mode: "verbatim" as const,
  text: "[VISUAL] Pricing: $19/mo",
};

const sampleBrief = {
  summary: "Generated summary",
  sections: [],
  relatedLinks: [],
  otherLinks: [],
};

const sampleBriefMetrics = {
  inputTokens: 1000,
  outputTokens: 200,
  model: "openai/gpt-5.5",
  latencyMs: 1234,
};

const sampleMetrics = {
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
  costSource: "cli-reported" as const,
};

const baseSubmission: TranscriptSubmission = {
  schemaVersion: "2.0.0",
  videoId: "abc123XYZAB",
  transcript: [sampleSpeech],
  frames: { kind: "not-requested" },
};

const baseCtx = { userId: "user_01" };

function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  return {
    fetchVideoMetadata: vi.fn().mockResolvedValue(sampleMetadata),
    generateBrief: vi.fn().mockResolvedValue({
      brief: sampleBrief,
      metrics: sampleBriefMetrics,
    }),
    saveSubmission: vi.fn().mockResolvedValue({ briefId: "brief_01abc" }),
    llmApiKey: "test-key",
    buildBriefUrl: (id: string) => `https://brief.test/brief/${id}`,
    ...overrides,
  };
}

describe("toFlatSpeechEntries", () => {
  it("converts speech entries to the legacy flat shape", () => {
    expect(toFlatSpeechEntries([sampleSpeech])).toEqual([
      { text: "Hello world", offset: 0, duration: 5.2 },
    ]);
  });

  it("filters out visual entries", () => {
    const result = toFlatSpeechEntries([sampleSpeech, sampleVisual]);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toBe("Hello world");
  });

  it("preserves lang on speech entries when present", () => {
    const result = toFlatSpeechEntries([{ ...sampleSpeech, lang: "en" }]);
    expect(result[0]?.lang).toBe("en");
  });

  it("omits lang on entries that don't have it", () => {
    expect(toFlatSpeechEntries([sampleSpeech])[0]).not.toHaveProperty("lang");
  });
});

describe("handleIntake", () => {
  it("returns ok with briefUrl + brief on a speech-only submission", async () => {
    const deps = makeDeps();
    const result = await handleIntake(baseSubmission, baseCtx, deps);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.response.briefId).toBe("brief_01abc");
      expect(result.response.briefUrl).toBe("https://brief.test/brief/brief_01abc");
      expect(result.response.brief).toEqual(sampleBrief);
      expect(result.response.metadata).toEqual(sampleMetadata);
      expect(result.response.schemaVersion).toBe("2.0.0");
    }
  });

  it("fetches metadata server-side from videoId", async () => {
    const deps = makeDeps();
    await handleIntake(baseSubmission, baseCtx, deps);
    expect(deps.fetchVideoMetadata).toHaveBeenCalledWith("abc123XYZAB");
  });

  it("calls generateBrief with speech-only entries in the legacy web shape", async () => {
    const deps = makeDeps();
    await handleIntake(
      { ...baseSubmission, transcript: [sampleSpeech, sampleVisual] },
      baseCtx,
      deps,
    );

    expect(deps.generateBrief).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(deps.generateBrief).mock.calls[0];
    expect(args.transcript).toEqual([{ text: "Hello world", offset: 0, duration: 5.2 }]);
    expect(args.metadata).toEqual(sampleMetadata);
    expect(args.apiKey).toBe("test-key");
    expect(args.augmentedTranscript).toBeUndefined();
  });

  it("forwards the augmented transcript to generateBrief when frames are included", async () => {
    const deps = makeDeps();
    const augmented = "[0:00-0:05] Hello world\n\n[0:30] [VISUAL] Pricing: $19/mo";
    await handleIntake(
      {
        ...baseSubmission,
        frames: { kind: "included", transcript: augmented, metrics: sampleMetrics },
      },
      baseCtx,
      deps,
    );
    const [args] = vi.mocked(deps.generateBrief).mock.calls[0];
    expect(args.augmentedTranscript).toBe(augmented);
  });

  it("persists the row with sum-type entries (preserves visual)", async () => {
    const deps = makeDeps();
    await handleIntake(
      { ...baseSubmission, transcript: [sampleSpeech, sampleVisual] },
      baseCtx,
      deps,
    );

    expect(deps.saveSubmission).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(deps.saveSubmission).mock.calls[0];
    expect(args.userId).toBe("user_01");
    expect(args.videoId).toBe("abc123XYZAB");
    expect(args.metadata).toEqual(sampleMetadata);
    expect(args.transcript).toHaveLength(2);
    expect(args.transcript[0]).toEqual(sampleSpeech);
    expect(args.transcript[1]).toEqual(sampleVisual);
  });

  it("passes frames discriminator + metrics to saveSubmission", async () => {
    const deps = makeDeps();
    const augmentedFrames = {
      kind: "included" as const,
      transcript: "[0:00] [VISUAL] something",
      metrics: sampleMetrics,
    };
    await handleIntake(
      { ...baseSubmission, frames: augmentedFrames },
      baseCtx,
      deps,
    );
    const [args] = vi.mocked(deps.saveSubmission).mock.calls[0];
    expect(args.frames).toEqual(augmentedFrames);
  });

  it("persists brief generation metrics from generateBrief", async () => {
    const deps = makeDeps();
    await handleIntake(baseSubmission, baseCtx, deps);
    const [args] = vi.mocked(deps.saveSubmission).mock.calls[0];
    expect(args.briefMetrics).toEqual(sampleBriefMetrics);
    expect(args.brief).toEqual(sampleBrief);
  });

  it("returns transient when fetchVideoMetadata throws", async () => {
    const deps = makeDeps({
      fetchVideoMetadata: vi.fn().mockRejectedValue(new Error("Video not found")),
    });
    const result = await handleIntake(baseSubmission, baseCtx, deps);
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/Video not found/);
    }
    expect(deps.generateBrief).not.toHaveBeenCalled();
    expect(deps.saveSubmission).not.toHaveBeenCalled();
  });

  it("returns transient when generateBrief throws", async () => {
    const deps = makeDeps({
      generateBrief: vi.fn().mockRejectedValue(new Error("LLM down")),
    });
    const result = await handleIntake(baseSubmission, baseCtx, deps);
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/LLM down/);
    }
    expect(deps.saveSubmission).not.toHaveBeenCalled();
  });

  it("returns transient when saveSubmission throws", async () => {
    const deps = makeDeps({
      saveSubmission: vi.fn().mockRejectedValue(new Error("DB unavailable")),
    });
    const result = await handleIntake(baseSubmission, baseCtx, deps);
    expect(result.kind).toBe("transient");
  });
});
