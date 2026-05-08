import { describe, expect, it } from "vitest";
import { extractVideoId } from "./parser";

describe("extractVideoId", () => {
  describe("URL formats", () => {
    it("extracts from a standard youtube.com/watch URL", () => {
      expect(
        extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      ).toBe("dQw4w9WgXcQ");
    });

    it("extracts from a youtu.be short URL", () => {
      expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
        "dQw4w9WgXcQ"
      );
    });

    it("extracts from a mobile m.youtube.com URL", () => {
      expect(
        extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
      ).toBe("dQw4w9WgXcQ");
    });

    it("extracts from an embed URL", () => {
      expect(
        extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")
      ).toBe("dQw4w9WgXcQ");
    });

    it("ignores query params after the id (&t=)", () => {
      expect(
        extractVideoId(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123s"
        )
      ).toBe("dQw4w9WgXcQ");
    });

    it("ignores query params before the id", () => {
      expect(
        extractVideoId(
          "https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ"
        )
      ).toBe("dQw4w9WgXcQ");
    });
  });

  describe("bare 11-character IDs", () => {
    it("accepts a bare alphanumeric ID", () => {
      expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("accepts an ID containing hyphens", () => {
      expect(extractVideoId("a-b-c-d-e-f")).toBe("a-b-c-d-e-f");
    });

    it("accepts an ID containing underscores", () => {
      expect(extractVideoId("a_b_c_d_e_f")).toBe("a_b_c_d_e_f");
    });
  });

  describe("invalid input", () => {
    it("rejects 10-character strings", () => {
      expect(extractVideoId("dQw4w9WgXc")).toBeNull();
    });

    it("rejects 12-character strings", () => {
      expect(extractVideoId("dQw4w9WgXcQQ")).toBeNull();
    });

    it("rejects empty string", () => {
      expect(extractVideoId("")).toBeNull();
    });

    it("rejects bare strings with illegal chars", () => {
      expect(extractVideoId("dQw4w9WgX!Q")).toBeNull();
    });

    it("rejects unrelated URLs", () => {
      expect(extractVideoId("https://example.com/foo/bar")).toBeNull();
    });

    it("rejects youtube URLs with malformed video ids", () => {
      expect(
        extractVideoId("https://www.youtube.com/watch?v=tooshort")
      ).toBeNull();
    });
  });
});
