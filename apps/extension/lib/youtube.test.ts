import { describe, expect, it } from "vitest";
import { extractVideoId as extractCoreVideoId } from "@brief/core";
import { extractVideoId } from "./youtube";

const urls: Array<{ input: string; expected: string | null }> = [
  {
    input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://youtube.com/watch?v=dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://youtu.be/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://youtube.com/shorts/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://www.youtube.com/live/dQw4w9WgXcQ",
    expected: "dQw4w9WgXcQ",
  },
  {
    input: "https://youtu.be/not-a-real-id",
    expected: null,
  },
  {
    input: "https://www.youtube.com/shorts/tooshort",
    expected: null,
  },
  {
    input: "https://example.com/watch?v=dQw4w9WgXcQ",
    expected: null,
  },
  {
    input: "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    expected: null,
  },
  {
    input: "https://evil.com/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    expected: null,
  },
  {
    input: "https://fakeyoutu.be/dQw4w9WgXcQ",
    expected: null,
  },
];

describe("extractVideoId", () => {
  it.each(urls)("matches core for $input", ({ input, expected }) => {
    expect(extractCoreVideoId(input)).toBe(expected);
    expect(extractVideoId(input)).toBe(expected);
  });
});
