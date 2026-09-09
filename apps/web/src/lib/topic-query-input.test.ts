import { describe, expect, it } from "vitest";
import { parseTopicQuery } from "./topic-query-input";

describe("parseTopicQuery", () => {
  it("trims the search it hands on", () => {
    expect(parseTopicQuery("  rust async runtime  ")).toEqual({
      ok: true,
      value: "rust async runtime",
    });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["only a newline", "\n"],
  ])("refuses a search that is %s", (_label, raw) => {
    const parsed = parseTopicQuery(raw);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.length).toBeGreaterThan(0);
  });
});
