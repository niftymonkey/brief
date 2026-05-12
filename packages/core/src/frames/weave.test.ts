import { describe, it, expect } from "vitest";
import type { TranscriptEntry } from "../types";
import { fmtTime, weave } from "./weave";
import type { Candidate } from "./selection";

const speech = (offsetSec: number, text: string, durationSec = 2): TranscriptEntry => ({
  offsetSec,
  durationSec,
  text,
});

const visualCandidate = (t: number, description: string): Candidate => ({
  t,
  source: `scene-change`,
  vision: { description, inputTokens: 0, outputTokens: 0 },
});

describe("fmtTime", () => {
  it("formats sub-minute timestamps as M:SS with zero-padded seconds", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(5)).toBe("0:05");
    expect(fmtTime(59.9)).toBe("0:59");
  });

  it("does not zero-pad minutes — `120:30` not `02:00:30`", () => {
    expect(fmtTime(60)).toBe("1:00");
    expect(fmtTime(125)).toBe("2:05");
    expect(fmtTime(7230)).toBe("120:30");
  });
});

describe("weave", () => {
  it("places a [VISUAL] block at the visual's timestamp", () => {
    const out = weave(
      [speech(0, "Hello"), speech(2, "world")],
      [visualCandidate(1.5, "[Slide] Welcome")],
    );
    expect(out).toContain("[0:01] [VISUAL] [Slide] Welcome");
  });

  it("flushes the in-flight transcript buffer when a visual interrupts it", () => {
    // Without an interrupt, two transcript entries don't reach the 4-entry / 12s flush
    // threshold and stay buffered. A visual must force them out so it appears at the
    // right point in the narrative, not before the speech it interrupts.
    const out = weave(
      [speech(0, "Hello"), speech(3, "world")],
      [visualCandidate(5, "[Diagram] flow")],
    );
    const speechIdx = out.indexOf("Hello world");
    const visualIdx = out.indexOf("[VISUAL]");
    expect(speechIdx).toBeGreaterThanOrEqual(0);
    expect(visualIdx).toBeGreaterThan(speechIdx);
  });

  it("flushes the transcript buffer after 4 entries even without a visual", () => {
    const out = weave(
      [
        speech(0, "one"),
        speech(2, "two"),
        speech(4, "three"),
        speech(6, "four"),
        speech(8, "five"),
      ],
      [],
    );
    // First four entries flush together; the fifth is in a fresh buffer.
    expect(out).toMatch(/\[0:00-0:08\] one two three four/);
    expect(out).toMatch(/\[0:08-0:10\] five/);
  });

  it("flushes the transcript buffer when an entry pushes the span past 12 seconds", () => {
    const out = weave(
      [
        speech(0, "alpha"),
        speech(2, "beta"),
        speech(15, "gamma"), // ends at 17 — span from 0 is >12, must trigger flush
      ],
      [],
    );
    expect(out).toMatch(/\[0:00-0:17\] alpha beta gamma/);
  });

  it("emits speech blocks with [MM:SS-MM:SS] anchors", () => {
    const out = weave([speech(65, "First"), speech(68, "second", 4)], []);
    expect(out).toContain("[1:05-1:12] First second");
  });

  it("strips bold/italic/underscore markdown emphasis from visual text", () => {
    const out = weave(
      [],
      [visualCandidate(5, "Pricing **table** with *new* tier and _bold_ feature")],
    );
    expect(out).toContain("[0:05] [VISUAL] Pricing table with new tier and bold feature");
    expect(out).not.toContain("**");
    expect(out).not.toContain("_bold_");
  });

  it("preserves newlines and indentation inside visual text (verbatim regression)", () => {
    // Verbatim content from VERBATIM mode arrives with structural whitespace —
    // multi-line code/config blocks. The chunk-and-squash regex must NOT collapse
    // them like it does the speech buffer. This was the spike's documented regression.
    const verbatim = "```\nfunction foo() {\n    return 42;\n}\n```";
    const out = weave([], [visualCandidate(0, `[Code] example\n${verbatim}`)]);
    expect(out).toContain("```\nfunction foo() {\n    return 42;\n}\n```");
  });

  it("orders interleaved blocks by timestamp", () => {
    const out = weave(
      [speech(0, "intro"), speech(10, "outro")],
      [visualCandidate(5, "[Mid] visual")],
    );
    const introIdx = out.indexOf("intro");
    const visualIdx = out.indexOf("[Mid] visual");
    const outroIdx = out.indexOf("outro");
    expect(introIdx).toBeLessThan(visualIdx);
    expect(visualIdx).toBeLessThan(outroIdx);
  });

  it("ignores candidates that have no vision description", () => {
    const noDescription: Candidate = { t: 5, source: "scene-change" };
    const out = weave([speech(0, "hello")], [noDescription]);
    expect(out).not.toContain("[VISUAL]");
  });

  it("returns an empty string when there's nothing to weave", () => {
    expect(weave([], [])).toBe("");
  });
});
