import { describe, expect, it } from "vitest";
import {
  buildSitting,
  formatRuntimeWords,
  isEntryActive,
  resolveActiveEntryId,
  type EntryVideoFacts,
  type SittingItem,
} from "./collection-entries";

function item(overrides: Partial<SittingItem> & { id: string }): SittingItem {
  return {
    videoId: "vid",
    startSec: null,
    endSec: null,
    videoTitle: null,
    ...overrides,
  };
}

const noFacts: Record<string, EntryVideoFacts> = {};

describe("buildSitting", () => {
  it("numbers entries from one and gives each an entry anchor", () => {
    const sitting = buildSitting(
      [item({ id: "a" }), item({ id: "b" })],
      noFacts,
    );

    expect(sitting.entries.map((entry) => entry.ordinal)).toEqual([1, 2]);
    expect(sitting.entries.map((entry) => entry.anchorId)).toEqual(["entry-1", "entry-2"]);
  });

  it("derives a bounded entry's length from its own bounds, with no video facts", () => {
    const sitting = buildSitting(
      [item({ id: "a", startSec: 724, endSec: 1178 })],
      noFacts,
    );

    expect(sitting.entries[0].durationSec).toBe(454);
    expect(sitting.entries[0].offsetSec).toBe(0);
    expect(sitting.totalRuntimeSec).toBe(454);
    expect(sitting.runtimeComplete).toBe(true);
  });

  it("derives an unbounded entry's length from the video's own length", () => {
    const sitting = buildSitting([item({ id: "a", videoId: "x" })], {
      x: { title: null, channelName: null, durationSec: 58 },
    });

    expect(sitting.entries[0].durationSec).toBe(58);
    expect(sitting.totalRuntimeSec).toBe(58);
  });

  it("runs an open-ended entry to the end of its video", () => {
    const sitting = buildSitting([item({ id: "a", videoId: "x", startSec: 30 })], {
      x: { title: null, channelName: null, durationSec: 100 },
    });

    expect(sitting.entries[0].durationSec).toBe(70);
  });

  it("clamps an end bound that runs past the video's own length", () => {
    const sitting = buildSitting([item({ id: "a", videoId: "x", startSec: 90, endSec: 200 })], {
      x: { title: null, channelName: null, durationSec: 100 },
    });

    expect(sitting.entries[0].durationSec).toBe(10);
  });

  it("stacks each entry's start position on the lengths before it", () => {
    const sitting = buildSitting(
      [
        item({ id: "a", startSec: 0, endSec: 58 }),
        item({ id: "b", startSec: 100, endSec: 554 }),
        item({ id: "c", startSec: 0, endSec: 647 }),
      ],
      noFacts,
    );

    expect(sitting.entries.map((entry) => entry.offsetSec)).toEqual([0, 58, 512]);
    expect(sitting.totalRuntimeSec).toBe(58 + 454 + 647);
    expect(sitting.runtimeComplete).toBe(true);
  });

  it("reports an incomplete runtime when any entry's length is unknown", () => {
    const sitting = buildSitting(
      [item({ id: "a", startSec: 0, endSec: 58 }), item({ id: "b" })],
      noFacts,
    );

    expect(sitting.entries[1].durationSec).toBeNull();
    expect(sitting.totalRuntimeSec).toBeNull();
    expect(sitting.runtimeComplete).toBe(false);
  });

  it("leaves the start position unknown from the first unknown length onward", () => {
    const sitting = buildSitting(
      [item({ id: "a" }), item({ id: "b", startSec: 0, endSec: 58 })],
      noFacts,
    );

    expect(sitting.entries.map((entry) => entry.offsetSec)).toEqual([0, null]);
  });

  it("has no runtime and no complete track when the collection is empty", () => {
    const sitting = buildSitting([], noFacts);

    expect(sitting.entries).toEqual([]);
    expect(sitting.totalRuntimeSec).toBeNull();
    expect(sitting.runtimeComplete).toBe(false);
  });

  it("prefers the item's snapshot title, then the video's, then the id", () => {
    const facts: Record<string, EntryVideoFacts> = {
      known: { title: "From the brief", channelName: "Fireship", durationSec: 58 },
    };

    const sitting = buildSitting(
      [
        item({ id: "a", videoId: "known", videoTitle: "Snapshot" }),
        item({ id: "b", videoId: "known" }),
        item({ id: "c", videoId: "unknown" }),
      ],
      facts,
    );

    expect(sitting.entries.map((entry) => entry.title)).toEqual([
      "Snapshot",
      "From the brief",
      "unknown",
    ]);
    expect(sitting.entries[0].channelName).toBe("Fireship");
    expect(sitting.entries[2].channelName).toBeNull();
  });

  it("phrases the source range for every combination of bounds", () => {
    const sitting = buildSitting(
      [
        item({ id: "a" }),
        item({ id: "b", startSec: 724, endSec: 1178 }),
        item({ id: "c", startSec: 724 }),
        item({ id: "d", endSec: 1178 }),
      ],
      noFacts,
    );

    expect(sitting.entries.map((entry) => entry.rangeLabel)).toEqual([
      "full clip",
      "12:04 to 19:38",
      "from 12:04",
      "to 19:38",
    ]);
    expect(sitting.entries.map((entry) => entry.kindLabel)).toEqual([
      "Full video",
      "Clip",
      "Clip",
      "Clip",
    ]);
  });

  it("points the watch link at the entry's own start", () => {
    const sitting = buildSitting(
      [item({ id: "a", videoId: "abc", startSec: 90 }), item({ id: "b", videoId: "abc" })],
      noFacts,
    );

    expect(sitting.entries[0].watchUrl).toBe("https://youtube.com/watch?v=abc&t=90s");
    expect(sitting.entries[1].watchUrl).toBe("https://youtube.com/watch?v=abc");
    expect(sitting.entries[0].thumbnailUrl).toBe("https://img.youtube.com/vi/abc/mqdefault.jpg");
  });
});

describe("resolveActiveEntryId", () => {
  const sitting = buildSitting(
    [item({ id: "first" }), item({ id: "second" }), item({ id: "third" })],
    noFacts,
  );

  it("reads the played item id as the entry id it names", () => {
    expect(resolveActiveEntryId(sitting.entries, "second")).toBe("second");
  });

  it("has no active entry while nothing is playing", () => {
    expect(resolveActiveEntryId(sitting.entries, null)).toBeNull();
  });

  it("has no active entry when the played item left the collection", () => {
    expect(resolveActiveEntryId(sitting.entries, "removed")).toBeNull();
  });

  it("has no active entry in an empty sitting", () => {
    expect(resolveActiveEntryId([], "first")).toBeNull();
  });
});

describe("isEntryActive", () => {
  const sitting = buildSitting([item({ id: "a" }), item({ id: "b" })], noFacts);

  it("marks only the entry the sitting is on", () => {
    const activeId = resolveActiveEntryId(sitting.entries, "b");

    expect(sitting.entries.map((entry) => isEntryActive(entry, activeId))).toEqual([false, true]);
  });

  it("marks nothing while no entry is active", () => {
    expect(sitting.entries.map((entry) => isEntryActive(entry, null))).toEqual([false, false]);
  });
});

describe("formatRuntimeWords", () => {
  it("spells minutes and seconds out", () => {
    expect(formatRuntimeWords(1976)).toBe("32 min 56 sec");
  });

  it("drops the seconds once the runtime passes an hour", () => {
    expect(formatRuntimeWords(3852)).toBe("1 hr 4 min");
  });

  it("keeps a whole minute and a bare hour clean", () => {
    expect(formatRuntimeWords(120)).toBe("2 min");
    expect(formatRuntimeWords(3600)).toBe("1 hr");
  });

  it("falls back to seconds for a very short sitting", () => {
    expect(formatRuntimeWords(45)).toBe("45 sec");
    expect(formatRuntimeWords(0)).toBe("0 sec");
  });
});
