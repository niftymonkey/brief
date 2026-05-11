import { describe, expect, it } from "vitest";
import {
  CLASSIFY_MODEL,
  DIGEST_MODEL,
  PRICING,
  VISION_MODEL,
  estimateCost,
} from "./models";

describe("role constants (unconfigured state)", () => {
  // Until `discover-candidates` runs and models.ts is updated, these are
  // empty strings. summarize.ts and the (future) frames module pass these
  // straight to the Anthropic SDK, which rejects the empty string with a
  // clear error — that's the "blocked until discovery runs" signal.
  it("DIGEST_MODEL is a string", () => {
    expect(typeof DIGEST_MODEL).toBe("string");
  });

  it("CLASSIFY_MODEL is a string", () => {
    expect(typeof CLASSIFY_MODEL).toBe("string");
  });

  it("VISION_MODEL is a string", () => {
    expect(typeof VISION_MODEL).toBe("string");
  });
});

describe("PRICING table consistency", () => {
  // Every configured role constant (non-empty string) must have a pricing row.
  // Empty strings (unconfigured) are skipped — they're not yet ready to call.
  const configured = [
    ["DIGEST_MODEL", DIGEST_MODEL],
    ["CLASSIFY_MODEL", CLASSIFY_MODEL],
    ["VISION_MODEL", VISION_MODEL],
  ].filter(([, id]) => id !== "");

  if (configured.length === 0) {
    it.skip("(no configured roles yet — run discover-candidates)", () => {});
  } else {
    it.each(configured)("%s has a pricing row", (_name, id) => {
      expect(PRICING[id as string]).toBeDefined();
      expect(PRICING[id as string].input).toBeGreaterThan(0);
      expect(PRICING[id as string].output).toBeGreaterThan(0);
    });
  }
});

describe("estimateCost", () => {
  it("throws on unknown model", () => {
    expect(() => estimateCost("not-a-real-model", 1000, 1000)).toThrow();
  });

  it("throws on the empty placeholder string", () => {
    // Confirms unconfigured constants don't accidentally compute cost.
    expect(() => estimateCost("", 1000, 1000)).toThrow();
  });

  // Once a model is in PRICING, these tests should be expanded with the
  // actual model IDs and price points. Math contract: cost = input * (in/M) + output * (out/M).
  it("computes cost when the model has a pricing row", () => {
    PRICING["__test-model"] = { input: 3, output: 15 };
    try {
      // 1M input + 1M output = 3 + 15 = 18
      expect(estimateCost("__test-model", 1_000_000, 1_000_000)).toBeCloseTo(
        18,
        6,
      );
      // Scales linearly: 500K input + 200K output at $3/$15 = 1.5 + 3 = 4.5
      expect(estimateCost("__test-model", 500_000, 200_000)).toBeCloseTo(
        4.5,
        6,
      );
      // Zero tokens = 0
      expect(estimateCost("__test-model", 0, 0)).toBe(0);
    } finally {
      delete PRICING["__test-model"];
    }
  });
});
