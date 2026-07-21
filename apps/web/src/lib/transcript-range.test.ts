import { describe, it, expect } from "vitest";
import { sliceTranscriptRange, rangeTranscriptText } from "./transcript-range";
import type { StoredTranscriptEntry } from "./types";

function entry(offsetSec: number, durationSec: number, text: string): StoredTranscriptEntry {
  return { offsetSec, durationSec, text };
}

const script: StoredTranscriptEntry[] = [
  entry(0, 5, "alpha"),
  entry(5, 5, "bravo"),
  entry(10, 5, "charlie"),
  entry(15, 5, "delta"),
  entry(20, 5, "echo"),
];

describe("sliceTranscriptRange", () => {
  it("returns every entry when both bounds are null (whole video)", () => {
    const sliced = sliceTranscriptRange(script, null, null);
    expect(sliced.map((e) => e.text)).toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
  });

  it("keeps only entries overlapping the [start, end] window", () => {
    const sliced = sliceTranscriptRange(script, 6, 12, 0);
    expect(sliced.map((e) => e.text)).toEqual(["bravo", "charlie"]);
  });

  it("includes an entry that ends just before the start when within tolerance", () => {
    // bravo spans [5,10); with start=11 and tolerance=2, bravo's end (10) is
    // within [start - tol] = 9, so it is pulled in for boundary context. delta
    // (starts at 15) stays out because end=12 widened by 2 only reaches 14.
    const sliced = sliceTranscriptRange(script, 11, 12, 2);
    expect(sliced.map((e) => e.text)).toEqual(["bravo", "charlie"]);
  });

  it("excludes an entry outside the window once tolerance no longer reaches it", () => {
    const sliced = sliceTranscriptRange(script, 11, 13, 0);
    expect(sliced.map((e) => e.text)).toEqual(["charlie"]);
  });

  it("treats a null start as 'from the beginning'", () => {
    const sliced = sliceTranscriptRange(script, null, 7, 0);
    expect(sliced.map((e) => e.text)).toEqual(["alpha", "bravo"]);
  });

  it("treats a null end as 'through the end'", () => {
    const sliced = sliceTranscriptRange(script, 16, null, 0);
    expect(sliced.map((e) => e.text)).toEqual(["delta", "echo"]);
  });

  it("returns an empty slice when the window lands past every entry", () => {
    expect(sliceTranscriptRange(script, 100, 200, 2)).toEqual([]);
  });

  it("tolerates a zero-duration entry sitting exactly at the start", () => {
    const withPoint = [entry(8, 0, "point"), ...script];
    const sliced = sliceTranscriptRange(withPoint, 8, 9, 0);
    expect(sliced.map((e) => e.text)).toContain("point");
  });
});

describe("rangeTranscriptText", () => {
  it("joins the sliced entries' text with single spaces", () => {
    expect(rangeTranscriptText([entry(0, 5, "one"), entry(5, 5, "two")])).toBe("one two");
  });

  it("collapses internal whitespace and drops empty entries", () => {
    const messy = [entry(0, 5, "  one \n"), entry(5, 5, ""), entry(10, 5, "two  ")];
    expect(rangeTranscriptText(messy)).toBe("one two");
  });
});
