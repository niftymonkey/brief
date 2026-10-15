import { describe, expect, it } from "vitest";
import { formatRange, formatSeconds, neighborsOf, reorderById } from "./collection-item-input";

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

describe("reorderById", () => {
  const ids = ["a", "b", "c", "d"];

  it("drops an item onto a later one by taking that one's place", () => {
    expect(reorderById(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("drops an item onto an earlier one by taking that one's place", () => {
    expect(reorderById(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone when an item is dropped on itself", () => {
    expect(reorderById(ids, "b", "b")).toEqual(ids);
  });

  it("leaves the order alone when either id is not in the list", () => {
    expect(reorderById(ids, "z", "b")).toEqual(ids);
    expect(reorderById(ids, "b", "z")).toEqual(ids);
  });

  it("does not mutate the order it was given", () => {
    const original = [...ids];
    reorderById(ids, "a", "d");
    expect(ids).toEqual(original);
  });
});

describe("neighborsOf", () => {
  const ids = ["a", "b", "c", "d"];

  it("reads an interior item's neighbours from the settled order", () => {
    expect(neighborsOf(ids, "c")).toEqual({ afterItemId: "b", beforeItemId: "d" });
  });

  it("gives the first item a null after-neighbour", () => {
    expect(neighborsOf(ids, "a")).toEqual({ afterItemId: null, beforeItemId: "b" });
  });

  it("gives the last item a null before-neighbour", () => {
    expect(neighborsOf(ids, "d")).toEqual({ afterItemId: "c", beforeItemId: null });
  });

  it("returns null for an id that is not in the list", () => {
    expect(neighborsOf(ids, "z")).toBeNull();
  });

  it("gives a lone item two null neighbours, which is a no-op move", () => {
    expect(neighborsOf(["a"], "a")).toEqual({ afterItemId: null, beforeItemId: null });
  });
});
