import { describe, expect, it } from "vitest";
import { formatRange, formatSeconds, reorderNeighbors } from "./collection-item-input";

describe("formatSeconds", () => {
  it("formats sub-minute offsets as M:SS", () => {
    expect(formatSeconds(9)).toBe("0:09");
  });

  it("formats minute offsets with zero-padded seconds", () => {
    expect(formatSeconds(75)).toBe("1:15");
  });

  it("switches to H:MM:SS past an hour", () => {
    expect(formatSeconds(3661)).toBe("1:01:01");
  });

  it("treats negative input as zero", () => {
    expect(formatSeconds(-5)).toBe("0:00");
  });
});

describe("formatRange", () => {
  it("is empty when the item points at the whole video", () => {
    expect(formatRange(null, null)).toBe("");
  });

  it("renders a bounded range", () => {
    expect(formatRange(10, 20)).toBe("0:10 - 0:20");
  });

  it("renders a start-only range", () => {
    expect(formatRange(30, null)).toBe("from 0:30");
  });

  it("renders an end-only range", () => {
    expect(formatRange(null, 45)).toBe("to 0:45");
  });
});

describe("reorderNeighbors", () => {
  const ids = ["a", "b", "c", "d"];

  it("returns null when moving the first item up", () => {
    expect(reorderNeighbors(ids, 0, "up")).toBeNull();
  });

  it("returns null when moving the last item down", () => {
    expect(reorderNeighbors(ids, 3, "down")).toBeNull();
  });

  it("moves an interior item up between its two preceding neighbors", () => {
    expect(reorderNeighbors(ids, 2, "up")).toEqual({ afterItemId: "a", beforeItemId: "b" });
  });

  it("moves an item to the very top with a null after-neighbor", () => {
    expect(reorderNeighbors(ids, 1, "up")).toEqual({ afterItemId: null, beforeItemId: "a" });
  });

  it("moves an interior item down between its two following neighbors", () => {
    expect(reorderNeighbors(ids, 1, "down")).toEqual({ afterItemId: "c", beforeItemId: "d" });
  });

  it("moves an item to the very bottom with a null before-neighbor", () => {
    expect(reorderNeighbors(ids, 2, "down")).toEqual({ afterItemId: "d", beforeItemId: null });
  });

  it("returns null for an out-of-range index", () => {
    expect(reorderNeighbors(ids, 9, "up")).toBeNull();
  });
});
