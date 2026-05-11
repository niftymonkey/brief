import { describe, expect, it } from "vitest";
import {
  CLASSIFY_MODEL,
  DIGEST_MODEL,
  PRICING,
  VISION_MODEL,
  estimateCost,
} from "./models";

const ROLES = [
  ["DIGEST_MODEL", DIGEST_MODEL],
  ["CLASSIFY_MODEL", CLASSIFY_MODEL],
  ["VISION_MODEL", VISION_MODEL],
] as const;

describe("role constants", () => {
  it.each(ROLES)("%s is a non-empty string", (_name, id) => {
    expect(typeof id).toBe("string");
    expect(id).not.toBe("");
  });
});

describe("PRICING table consistency", () => {
  it.each(ROLES)("%s has a pricing row", (_name, id) => {
    expect(PRICING[id]).toBeDefined();
    expect(PRICING[id].input).toBeGreaterThan(0);
    expect(PRICING[id].output).toBeGreaterThan(0);
  });
});

describe("estimateCost", () => {
  it("throws on unknown model", () => {
    expect(() => estimateCost("not-a-real-model", 1000, 1000)).toThrow();
  });

  it("throws on the empty model id", () => {
    expect(() => estimateCost("", 1000, 1000)).toThrow();
  });

  it("throws on negative token counts", () => {
    expect(() => estimateCost(DIGEST_MODEL, -1, 0)).toThrow();
    expect(() => estimateCost(DIGEST_MODEL, 0, -1)).toThrow();
  });

  it("throws on non-finite token counts", () => {
    expect(() => estimateCost(DIGEST_MODEL, Number.NaN, 0)).toThrow();
    expect(() =>
      estimateCost(DIGEST_MODEL, Number.POSITIVE_INFINITY, 0),
    ).toThrow();
  });

  it("computes cost using the pricing rate", () => {
    PRICING["__test-model"] = { input: 3, output: 15 };
    try {
      // 1M input + 1M output = 3 + 15 = 18
      expect(estimateCost("__test-model", 1_000_000, 1_000_000)).toBeCloseTo(
        18,
        6,
      );
      // 500K input + 200K output at $3/$15 per M = 1.5 + 3 = 4.5
      expect(estimateCost("__test-model", 500_000, 200_000)).toBeCloseTo(4.5, 6);
      // Zero tokens = 0
      expect(estimateCost("__test-model", 0, 0)).toBe(0);
    } finally {
      delete PRICING["__test-model"];
    }
  });
});
