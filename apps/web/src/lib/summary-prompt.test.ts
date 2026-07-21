import { describe, it, expect } from "vitest";
import { summaryTier, buildSummaryPrompt } from "./summary-prompt";

describe("summaryTier", () => {
  it("maps a null range (whole Short) to the whole-short tier", () => {
    expect(summaryTier(null).id).toBe("whole-short");
  });

  it.each([
    [10, "micro"],
    [30, "micro"],
    [31, "brief"],
    [120, "brief"],
    [121, "standard"],
    [420, "standard"],
    [421, "extended"],
    [3600, "extended"],
  ])("maps a %ds range to the %s tier", (seconds, expected) => {
    expect(summaryTier(seconds).id).toBe(expected);
  });

  it("scales the output-token ceiling up with the tier length", () => {
    const micro = summaryTier(20).maxOutputTokens;
    const brief = summaryTier(90).maxOutputTokens;
    const standard = summaryTier(300).maxOutputTokens;
    const extended = summaryTier(1200).maxOutputTokens;
    expect(micro).toBeLessThan(brief);
    expect(brief).toBeLessThan(standard);
    expect(standard).toBeLessThan(extended);
  });

  it("imposes no chapter or bullet quota in any tier's guidance", () => {
    for (const seconds of [null, 20, 90, 300, 1200]) {
      const guidance = summaryTier(seconds).guidance.toLowerCase();
      expect(guidance).not.toMatch(/chapter/);
      expect(guidance).not.toMatch(/bullet/);
    }
  });

  it("asks a short clip for one to two sentences", () => {
    expect(summaryTier(20).guidance.toLowerCase()).toMatch(/sentence/);
  });
});

describe("buildSummaryPrompt", () => {
  it("embeds the sliced transcript text in the user prompt", () => {
    const { user } = buildSummaryPrompt({
      rangeSeconds: 45,
      transcriptText: "the speaker explains vector databases",
      videoTitle: "Intro to RAG",
    });
    expect(user).toContain("the speaker explains vector databases");
  });

  it("tells the model to describe this specific part for a ranged clip", () => {
    const { user } = buildSummaryPrompt({
      rangeSeconds: 45,
      transcriptText: "content",
    });
    expect(user.toLowerCase()).toMatch(/this (part|clip|segment|excerpt)/);
    expect(user.toLowerCase()).not.toMatch(/whole video|entire video/);
  });

  it("frames a whole-Short item as the whole (short) video", () => {
    const { user } = buildSummaryPrompt({
      rangeSeconds: null,
      transcriptText: "content",
    });
    expect(user.toLowerCase()).toMatch(/short/);
  });

  it("scales the guidance shown in the prompt to the range length", () => {
    const shortPrompt = buildSummaryPrompt({ rangeSeconds: 20, transcriptText: "x" }).user;
    const longPrompt = buildSummaryPrompt({ rangeSeconds: 1200, transcriptText: "x" }).user;
    expect(shortPrompt).toContain(summaryTier(20).guidance);
    expect(longPrompt).toContain(summaryTier(1200).guidance);
    expect(shortPrompt).not.toBe(longPrompt);
  });

  it("includes the video title when provided and omits the label when not", () => {
    const withTitle = buildSummaryPrompt({
      rangeSeconds: 45,
      transcriptText: "x",
      videoTitle: "My Talk",
    }).user;
    expect(withTitle).toContain("My Talk");

    const withoutTitle = buildSummaryPrompt({ rangeSeconds: 45, transcriptText: "x" }).user;
    expect(withoutTitle.toLowerCase()).not.toContain("title:");
  });
});
