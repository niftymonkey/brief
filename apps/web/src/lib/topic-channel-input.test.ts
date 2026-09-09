import { describe, expect, it } from "vitest";
import { parseTopicChannelInput } from "./topic-channel-input";

const ID = "UCbRP3c757lWg9M-U7TyEkXA";

describe("parseTopicChannelInput", () => {
  it("takes a bare channel id and builds the canonical channel URL", () => {
    const parsed = parseTopicChannelInput(ID, "");

    expect(parsed).toEqual({
      ok: true,
      value: {
        youtubeChannelId: ID,
        channelUrl: `https://www.youtube.com/channel/${ID}`,
        channelTitle: null,
      },
    });
  });

  it("reads the id out of a channel URL", () => {
    const parsed = parseTopicChannelInput(`https://www.youtube.com/channel/${ID}`, "Theo");

    expect(parsed).toMatchObject({
      ok: true,
      value: { youtubeChannelId: ID, channelTitle: "Theo" },
    });
  });

  it.each([
    ["a trailing slash", `https://www.youtube.com/channel/${ID}/`],
    ["a videos tab", `https://www.youtube.com/channel/${ID}/videos`],
    ["a query string", `https://www.youtube.com/channel/${ID}?view=0`],
    ["no scheme", `www.youtube.com/channel/${ID}`],
    ["surrounding whitespace", `  https://www.youtube.com/channel/${ID}  `],
  ])("reads the id out of a channel URL with %s", (_label, raw) => {
    const parsed = parseTopicChannelInput(raw, "");

    expect(parsed).toMatchObject({ ok: true, value: { youtubeChannelId: ID } });
  });

  it("trims the title and stores nothing when it is blank", () => {
    const parsed = parseTopicChannelInput(ID, "  Theo  ");

    expect(parsed).toMatchObject({ ok: true, value: { channelTitle: "Theo" } });
    expect(parseTopicChannelInput(ID, "   ")).toMatchObject({
      ok: true,
      value: { channelTitle: null },
    });
  });

  it("tells a person where to find the id when they paste a handle", () => {
    const parsed = parseTopicChannelInput("https://www.youtube.com/@t3dotgg", "");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("channel ID");
  });

  it.each([
    ["a legacy custom URL", "https://www.youtube.com/c/Computerphile"],
    ["a legacy user URL", "https://www.youtube.com/user/Computerphile"],
    ["a bare handle", "@t3dotgg"],
  ])("refuses %s, which names no channel id", (_label, raw) => {
    const parsed = parseTopicChannelInput(raw, "");

    expect(parsed.ok).toBe(false);
  });

  it("refuses a video URL", () => {
    const parsed = parseTopicChannelInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "");

    expect(parsed.ok).toBe(false);
  });

  it("refuses an empty box", () => {
    const parsed = parseTopicChannelInput("   ", "");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it("refuses an id of the right shape but the wrong length", () => {
    const parsed = parseTopicChannelInput("UCtooshort", "");

    expect(parsed.ok).toBe(false);
  });
});
