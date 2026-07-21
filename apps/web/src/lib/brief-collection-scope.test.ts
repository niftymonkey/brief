import { describe, expect, it } from "vitest";
import { deriveChapterScopes } from "./brief-collection-scope";
import type { ContentSection } from "./types";

function section(
  title: string,
  timestampStart: string,
  timestampEnd: string,
): ContentSection {
  return { title, timestampStart, timestampEnd, keyPoints: [] };
}

describe("deriveChapterScopes", () => {
  it("derives start and end from a chapter's own timestamps", () => {
    const scopes = deriveChapterScopes([
      section("Intro", "0:00", "5:30"),
      section("Deep dive", "5:30", "12:00"),
    ]);

    expect(scopes).toEqual([
      { title: "Intro", startSec: 0, endSec: 330 },
      { title: "Deep dive", startSec: 330, endSec: 720 },
    ]);
  });

  it("parses H:MM:SS timestamps", () => {
    const scopes = deriveChapterScopes([section("Long", "1:01:01", "1:02:02")]);
    expect(scopes[0]).toEqual({ title: "Long", startSec: 3661, endSec: 3722 });
  });

  it("falls back to the next chapter's start when the end is missing", () => {
    const scopes = deriveChapterScopes([
      section("Intro", "0:00", ""),
      section("Next", "4:00", "9:00"),
    ]);

    expect(scopes[0]).toEqual({ title: "Intro", startSec: 0, endSec: 240 });
  });

  it("falls back to the next chapter's start when the end is not after the start", () => {
    const scopes = deriveChapterScopes([
      section("Intro", "2:00", "2:00"),
      section("Next", "6:00", "8:00"),
    ]);

    expect(scopes[0].endSec).toBe(360);
  });

  it("yields a start-only scope for the last chapter when its end is unavailable", () => {
    const scopes = deriveChapterScopes([
      section("Intro", "0:00", "3:00"),
      section("Outro", "3:00", ""),
    ]);

    expect(scopes[1]).toEqual({ title: "Outro", startSec: 180, endSec: null });
  });

  it("treats an unparseable start as the video beginning", () => {
    const scopes = deriveChapterScopes([section("Weird", "", "1:00")]);
    expect(scopes[0]).toEqual({ title: "Weird", startSec: 0, endSec: 60 });
  });

  it("rejects an out-of-range seconds component", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "1:75")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects an out-of-range minutes component in H:MM:SS", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "1:75:00")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects a fractional component", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "1:30.5")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects an empty trailing component", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "1:")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects a non-digit component", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "aa:bb")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects too many components", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "1:2:3:4")]);
    expect(scopes[0].endSec).toBeNull();
  });

  it("rejects a single bare number with no colon", () => {
    const scopes = deriveChapterScopes([section("A", "0:00", "90")]);
    expect(scopes[0].endSec).toBeNull();
  });
});
