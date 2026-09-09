import { describe, expect, it } from "vitest";
import { parseTopicSettings, type TopicSettingsFields } from "./topic-settings-input";

const VALID: TopicSettingsFields = {
  cadenceDays: "3",
  windowDays: "7",
  maxStandingQueries: "10",
  maxProbesPerRun: "5",
  maxGroupsPerRun: "4",
  maxVideosPerGroup: "3",
  maxChannelVideosPerRun: "10",
};

function fields(overrides: Partial<TopicSettingsFields>): TopicSettingsFields {
  return { ...VALID, ...overrides };
}

describe("parseTopicSettings", () => {
  it("reads the seven settings off the form as numbers", () => {
    const parsed = parseTopicSettings(VALID);

    expect(parsed).toEqual({
      ok: true,
      value: {
        cadenceDays: 3,
        windowDays: 7,
        maxStandingQueries: 10,
        maxProbesPerRun: 5,
        maxGroupsPerRun: 4,
        maxVideosPerGroup: 3,
        maxChannelVideosPerRun: 10,
      },
    });
  });

  it("accepts a window equal to the cadence", () => {
    const parsed = parseTopicSettings(fields({ cadenceDays: "7", windowDays: "7" }));

    expect(parsed.ok).toBe(true);
  });

  it("refuses a window shorter than the cadence in words, naming both numbers", () => {
    const parsed = parseTopicSettings(fields({ cadenceDays: "7", windowDays: "3" }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("7");
    expect(parsed.error).toContain("3");
    expect(parsed.error.toLowerCase()).toContain("window");
    expect(parsed.error).not.toContain("topics_window_days_check");
  });

  it("refuses a cadence below one day", () => {
    const parsed = parseTopicSettings(fields({ cadenceDays: "0" }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("at least 1");
  });

  it.each([
    ["blank", ""],
    ["not a number", "soon"],
    ["fractional", "3.5"],
    ["negative", "-2"],
  ])("refuses a cadence that is %s", (_label, cadenceDays) => {
    const parsed = parseTopicSettings(fields({ cadenceDays }));

    expect(parsed.ok).toBe(false);
  });

  it("refuses a cap below the floor its column enforces, and says which cap", () => {
    const parsed = parseTopicSettings(fields({ maxGroupsPerRun: "0" }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.toLowerCase()).toContain("group");
    expect(parsed.error).toContain("1");
  });

  it("allows zero for the two caps whose floor is zero", () => {
    const parsed = parseTopicSettings(
      fields({ maxStandingQueries: "0", maxProbesPerRun: "0" }),
    );

    expect(parsed.ok).toBe(true);
  });

  it("reports the schedule problem first when the caps are wrong too", () => {
    const parsed = parseTopicSettings(
      fields({ cadenceDays: "9", windowDays: "2", maxGroupsPerRun: "0" }),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.toLowerCase()).toContain("window");
  });

  it("ignores surrounding whitespace a number input can still carry", () => {
    const parsed = parseTopicSettings(fields({ windowDays: " 14 " }));

    expect(parsed).toMatchObject({ ok: true, value: { windowDays: 14 } });
  });
});
