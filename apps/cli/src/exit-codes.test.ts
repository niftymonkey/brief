import { describe, expect, it } from "vitest";
import { mapExitCode } from "./exit-codes";
import type { TranscriptResult } from "@brief/core";

describe("mapExitCode", () => {
  it("returns 0 for ok", () => {
    const r: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      entries: [],
    };
    expect(mapExitCode(r)).toBe(0);
  });

  it("returns 2 for pending", () => {
    const r: TranscriptResult = {
      kind: "pending",
      source: "supadata",
      jobId: "j",
      retryAfterSeconds: 90,
      message: "queued",
    };
    expect(mapExitCode(r)).toBe(2);
  });

  it("returns 3 for unavailable", () => {
    const r: TranscriptResult = {
      kind: "unavailable",
      reason: "no-captions",
      message: "no caps",
    };
    expect(mapExitCode(r)).toBe(3);
  });

  it("returns 4 for transient", () => {
    const r: TranscriptResult = {
      kind: "transient",
      cause: "net",
      message: "net err",
    };
    expect(mapExitCode(r)).toBe(4);
  });
});
