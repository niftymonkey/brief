import { describe, expect, it } from "vitest";
import { storableAspectRatio, storableVideoFacts } from "./storable-video-facts";

describe("storableAspectRatio", () => {
  it("keeps a ratio the column can hold", () => {
    expect(storableAspectRatio(16 / 9)).toBeCloseTo(1.7778, 4);
    expect(storableAspectRatio(0.5625)).toBe(0.5625);
    expect(storableAspectRatio(1.3333)).toBe(1.3333);
  });

  it("rejects a ratio that is not a finite number", () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "1.7778",
      null,
      undefined,
      {},
    ]) {
      expect(storableAspectRatio(value)).toBeNull();
    }
  });

  it("rejects a ratio that is not greater than zero", () => {
    expect(storableAspectRatio(0)).toBeNull();
    expect(storableAspectRatio(-0)).toBeNull();
    expect(storableAspectRatio(-1.7778)).toBeNull();
  });
});

describe("storableVideoFacts", () => {
  it("reduces every field independently", () => {
    expect(storableVideoFacts({ title: "  Kept  ", durationSec: 0, aspectRatio: 0.5625 })).toEqual({
      title: "Kept",
      durationSec: null,
      aspectRatio: 0.5625,
    });
  });

  it("drops only the aspect ratio when it alone is unstorable", () => {
    expect(
      storableVideoFacts({ title: "Kept", durationSec: 120, aspectRatio: Number.NaN }),
    ).toEqual({ title: "Kept", durationSec: 120, aspectRatio: null });
  });
});
