import { describe, it, expect } from "vitest";
import { briefGenerationError } from "./summarize";

const API_KEY_MESSAGE =
  "Invalid OpenRouter API key. Get a key at: https://openrouter.ai/keys";
const RATE_LIMIT_MESSAGE =
  "OpenRouter rate limit exceeded. Please wait and try again.";

const PREFIX = "Failed to generate brief: ";
const MAX_DETAIL_LENGTH = 2000;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("briefGenerationError", () => {
  it("maps a 401 status in the message to the API key error", () => {
    expect(briefGenerationError(new Error("Request failed with status 401")).message).toBe(
      API_KEY_MESSAGE
    );
  });

  it("maps a lowercase authentication failure to the API key error", () => {
    expect(briefGenerationError(new Error("authentication failed")).message).toBe(
      API_KEY_MESSAGE
    );
  });

  it("maps a capitalised authentication failure to the API key error", () => {
    expect(briefGenerationError(new Error("Authentication failed")).message).toBe(
      API_KEY_MESSAGE
    );
  });

  it("maps a lowercase rate limit failure to the rate limit error", () => {
    expect(briefGenerationError(new Error("provider rate limit reached")).message).toBe(
      RATE_LIMIT_MESSAGE
    );
  });

  it("maps a capitalised rate limit failure to the rate limit error", () => {
    expect(briefGenerationError(new Error("Rate Limit exceeded")).message).toBe(
      RATE_LIMIT_MESSAGE
    );
  });

  it("wraps an unclassified message in the generic failure", () => {
    expect(briefGenerationError(new Error("upstream exploded")).message).toBe(
      "Failed to generate brief: upstream exploded"
    );
  });

  it("serializes a message-less thrown value into the generic failure", () => {
    expect(briefGenerationError({ status: 500 }).message).toBe(
      'Failed to generate brief: {"status":500}'
    );
  });

  it("falls back to String() when the thrown value cannot be JSON-encoded", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(briefGenerationError(circular).message).toBe(
      "Failed to generate brief: [object Object]"
    );
  });

  it("falls back to String() for a BigInt thrown value", () => {
    expect(briefGenerationError(7n).message).toBe("Failed to generate brief: 7");
  });

  it("does not render undefined for a thrown value JSON drops", () => {
    const message = briefGenerationError(function boom() {}).message;

    expect(message).toContain("boom");
    expect(message).not.toContain("undefined");
  });

  it("leaves a detail at the cap untouched", () => {
    const detail = "x".repeat(MAX_DETAIL_LENGTH);

    expect(briefGenerationError(new Error(detail)).message).toBe(`${PREFIX}${detail}`);
  });

  it("truncates an oversized serialized value and reports the original length", () => {
    const thrown = { detail: "x".repeat(50_000) };
    const serializedLength = JSON.stringify(thrown).length;

    const message = briefGenerationError(thrown).message;

    expect(message.startsWith(`${PREFIX}{"detail":"xxx`)).toBe(true);
    expect(message.endsWith(`... [truncated from ${serializedLength} characters]`)).toBe(
      true
    );
    expect(message.length).toBeLessThan(PREFIX.length + MAX_DETAIL_LENGTH + 60);
  });

  it("truncates an oversized error message", () => {
    const detail = "y".repeat(70_000);

    const message = briefGenerationError(new Error(detail)).message;

    expect(message.endsWith(`... [truncated from ${detail.length} characters]`)).toBe(true);
    expect(message.length).toBeLessThan(PREFIX.length + MAX_DETAIL_LENGTH + 60);
  });

  it("does not split a surrogate pair when truncating", () => {
    // JSON.stringify prepends a quote, so the astral character's leading code
    // unit lands on the final slot a naive slice at the cap would keep.
    const detail = "a".repeat(MAX_DETAIL_LENGTH - 2) + "\u{1F600}" + "a".repeat(100);

    const message = briefGenerationError(detail).message;

    expect(LONE_SURROGATE.test(message)).toBe(false);
    expect(message).not.toContain("\u{1F600}");
  });

  it("truncates without throwing when the value only survives String()", () => {
    const circular: { self?: unknown; toString: () => string } = {
      toString: () => "z".repeat(MAX_DETAIL_LENGTH * 2),
    };
    circular.self = circular;

    const message = briefGenerationError(circular).message;

    expect(message.endsWith(`... [truncated from ${MAX_DETAIL_LENGTH * 2} characters]`)).toBe(
      true
    );
  });
});
