import { describe, it, expect } from "vitest";
import type { TranscriptEntry } from "../types";
import {
  CHAPTER_INTERIOR_RATIOS,
  DEDUP_WINDOW_S,
  TRANSCRIPT_CUE_PATTERNS,
  selectCandidates,
  type Chapter,
} from "./selection";

const speech = (offsetSec: number, text: string, durationSec = 2): TranscriptEntry => ({
  offsetSec,
  durationSec,
  text,
});

const chapter = (title: string, startSeconds: number, endSeconds: number): Chapter => ({
  title,
  startSeconds,
  endSeconds,
});

describe("TRANSCRIPT_CUE_PATTERNS", () => {
  const samples: Array<[string, string]> = [
    ["right here", "It's right here on the screen"],
    ["as you can see", "As you can see, the config is loaded"],
    ["you can see", "Now you can see how it works"],
    ["let me show", "Let me show you the dashboard"],
    ["i'll show you", "I'll show you the next step"],
    ["here's a", "Here's a snippet from the file"],
    ["look at this", "Look at this — it's the actual code"],
    ["this is the", "This is the part that matters"],
    ["watch this", "Now watch this"],
    ["pulling up", "I'm pulling up the config"],
    ["see how", "See how that's structured"],
    ["check this", "Check this out"],
    ["over here", "Over here on the left"],
  ];

  for (const [label, text] of samples) {
    it(`matches the "${label}" family in: ${text}`, () => {
      const hit = TRANSCRIPT_CUE_PATTERNS.some((re) => re.test(text));
      expect(hit).toBe(true);
    });
  }

  it("does not match unrelated narration", () => {
    const negatives = [
      "The system uses an architecture diagram to organize work.",
      "Most users underestimate the value of consistent prompting.",
      "He talks about productivity gains for about ten minutes.",
    ];
    for (const text of negatives) {
      const hit = TRANSCRIPT_CUE_PATTERNS.some((re) => re.test(text));
      expect(hit, `unexpected match for: ${text}`).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(TRANSCRIPT_CUE_PATTERNS.some((re) => re.test("RIGHT HERE"))).toBe(true);
  });
});

describe("selectCandidates", () => {
  const noChapters: Chapter[] = [];

  it("always seeds a video-start anchor at t=1", () => {
    const result = selectCandidates({
      scenes: [],
      chapters: noChapters,
      transcript: [],
      durationSec: 60,
    });
    expect(result.candidates.some((c) => c.t === 1 && c.source === "video-start")).toBe(true);
  });

  it("places a transcript-cue pair at t and t+3 for each cue match", () => {
    const result = selectCandidates({
      scenes: [],
      chapters: noChapters,
      transcript: [speech(30, "Right here you can see the pricing table")],
      durationSec: 120,
    });
    const cueAt = result.candidates.find((c) => c.t === 30);
    const cueAfter = result.candidates.find((c) => c.t === 33);
    expect(cueAt?.source).toMatch(/^transcript-cue:/);
    expect(cueAfter?.source).toMatch(/^transcript-cue-after:/);
  });

  it("only fires one cue pair per transcript entry even when multiple patterns match", () => {
    const result = selectCandidates({
      scenes: [],
      chapters: noChapters,
      // "right here" AND "you can see" both match — selection should only emit one pair.
      transcript: [speech(30, "Right here you can see it")],
      durationSec: 120,
    });
    const cueHits = result.candidates.filter((c) => c.source.startsWith("transcript-cue"));
    expect(cueHits).toHaveLength(2);
  });

  it("collapses candidates that fall within DEDUP_WINDOW_S of each other", () => {
    const result = selectCandidates({
      // two scene changes 1s apart — dedup window is 3s, so they collapse to one
      scenes: [10, 10.5, 11],
      chapters: noChapters,
      transcript: [],
      durationSec: 60,
    });
    const near10 = result.candidates.filter((c) => Math.abs(c.t - 10.5) < DEDUP_WINDOW_S);
    expect(near10).toHaveLength(1);
  });

  it("keeps the higher-priority source when dedup collapses neighbors", () => {
    // chapter-start (priority 4) lands at exactly the same time as scene-change (priority 2).
    const result = selectCandidates({
      scenes: [10],
      chapters: [chapter("Intro", 10, 60)],
      transcript: [],
      durationSec: 120,
    });
    const at10 = result.candidates.find((c) => Math.abs(c.t - 10) < 0.01);
    expect(at10?.source).toMatch(/^chapter-start:/);
  });

  it("emits chapter-interior candidates at 33% and 67% of each chapter's span", () => {
    const result = selectCandidates({
      scenes: [],
      chapters: [chapter("Body", 0, 90)],
      transcript: [],
      durationSec: 120,
    });
    const interiors = result.candidates
      .filter((c) => c.source.startsWith("chapter-interior"))
      .map((c) => c.t)
      .sort((a, b) => a - b);
    expect(interiors).toEqual([0 + 90 * CHAPTER_INTERIOR_RATIOS[0], 0 + 90 * CHAPTER_INTERIOR_RATIOS[1]]);
  });

  it("drops candidates within 0.5s of t=0 and within 0.5s of the video end", () => {
    const result = selectCandidates({
      scenes: [0.2, 59.8],
      chapters: noChapters,
      transcript: [],
      durationSec: 60,
    });
    expect(result.candidates.find((c) => c.t === 0.2)).toBeUndefined();
    expect(result.candidates.find((c) => c.t === 59.8)).toBeUndefined();
  });

  it("returns the pre-dedup count via candidatesGenerated", () => {
    const result = selectCandidates({
      scenes: [10, 10.5], // these collapse but still contribute to the raw count
      chapters: noChapters,
      transcript: [],
      durationSec: 60,
    });
    // 2 scenes + 1 video-start = 3 raw sources
    expect(result.candidatesGenerated).toBe(3);
    // 1 candidate after dedup (the two scenes merge) + 1 video-start = 2
    expect(result.candidates).toHaveLength(2);
  });

  it("returns candidates sorted by timestamp", () => {
    const result = selectCandidates({
      scenes: [40, 10, 25],
      chapters: noChapters,
      transcript: [],
      durationSec: 60,
    });
    const timestamps = result.candidates.map((c) => c.t);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});
