import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@vercel/postgres";
import { createCollection } from "../src/lib/collections";
import {
  countRepairableRows,
  describeRepair,
  isConfirmed,
  parseArgs,
  repairOneVideo,
  repairVideoFactsForVideo,
  resolveRunEnv,
} from "./backfill-video-facts";

interface StoredRow {
  videoTitle: string | null;
  durationSec: number | null;
  aspectRatio: number | null;
  updatedAt: string;
}

describe("repairVideoFactsForVideo", () => {
  // One token per run, base 36 so it stays short, shared by the user and by
  // every video id this suite writes. The repair scopes by video_id alone,
  // across every user and every collection, so a run that seeds a fixed id both
  // reads and writes rows an earlier interrupted run left behind.
  const runToken = Date.now().toString(36);
  const userId = `vitest-backfill-${runToken}`;
  const cleanupCollectionIds: string[] = [];

  /**
   * Builds a video id that belongs to this run alone and fits
   * `collection_items.video_id`, which is VARCHAR(20).
   */
  function videoIdFor(label: string): string {
    return `bf${runToken}${label}`;
  }

  function requireDb(): void {
    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL is required for the backfill db integration tests");
    }
  }

  async function seedItem(
    videoId: string,
    fields: { videoTitle: string | null; durationSec: number | null; aspectRatio?: number | null },
  ): Promise<void> {
    const collection = await createCollection(userId, { title: `Backfill ${videoId}` });
    cleanupCollectionIds.push(collection.id);
    await sql`
      INSERT INTO collection_items (
        collection_id, video_id, position, video_title, duration_sec, aspect_ratio
      )
      VALUES (
        ${collection.id}, ${videoId}, 1, ${fields.videoTitle}, ${fields.durationSec},
        ${fields.aspectRatio ?? null}
      )
    `;
  }

  async function readItem(videoId: string): Promise<StoredRow> {
    const result = await sql<StoredRow>`
      SELECT
        video_title as "videoTitle",
        duration_sec as "durationSec",
        aspect_ratio as "aspectRatio",
        updated_at as "updatedAt"
      FROM collection_items
      WHERE video_id = ${videoId}
    `;
    const row = result.rows[0];
    if (!row) throw new Error(`Expected a seeded row for ${videoId}`);
    return row;
  }

  afterAll(async () => {
    await sql`DELETE FROM collection_items WHERE video_id LIKE ${`bf${runToken}%`}`;
    for (const id of cleanupCollectionIds) {
      await sql`DELETE FROM collections WHERE id = ${id}`;
    }
  });

  it("fills the gaps the lookup answered and counts the rows it changed", async () => {
    requireDb();

    const videoId = videoIdFor("repairs");
    await seedItem(videoId, { videoTitle: null, durationSec: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Found Title",
        durationSec: 300,
        aspectRatio: 1.7778,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Found Title",
      durationSec: 300,
      aspectRatio: 1.7778,
    });
  });

  it("fills one field and leaves the other gap open when the lookup answered half", async () => {
    requireDb();

    const videoId = videoIdFor("half");
    await seedItem(videoId, { videoTitle: null, durationSec: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: null,
        durationSec: 600,
        aspectRatio: null,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: null,
      durationSec: 600,
      aspectRatio: null,
    });
  });

  it("reports no repair and leaves the row untouched when it cannot fill the open gap", async () => {
    requireDb();

    const videoId = videoIdFor("nofill");
    await seedItem(videoId, { videoTitle: null, durationSec: 600, aspectRatio: 1.7778 });
    const before = await readItem(videoId);

    // The row's only gap is its title, which this lookup could not name.
    expect(
      await repairVideoFactsForVideo(videoId, {
        title: null,
        durationSec: 600,
        aspectRatio: null,
      }),
    ).toBe(0);

    const after = await readItem(videoId);
    expect(after).toMatchObject({ videoTitle: null, durationSec: 600 });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("never overwrites a field another writer already filled", async () => {
    requireDb();

    const videoId = videoIdFor("noclobber");
    await seedItem(videoId, { videoTitle: "Already Named", durationSec: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Later Title",
        durationSec: 120,
        aspectRatio: 0.5625,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Already Named",
      durationSec: 120,
      aspectRatio: 0.5625,
    });
  });

  it("drops a runtime the column cannot hold instead of failing the write", async () => {
    requireDb();

    const videoId = videoIdFor("hugedur");
    await seedItem(videoId, { videoTitle: null, durationSec: null });

    // What YouTube answers for duration "PT999999999H". Interpolated as ::int
    // it is out of range for INTEGER and Postgres rejects the whole statement.
    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Huge Runtime",
        durationSec: 3_599_999_996_400,
        aspectRatio: 1.7778,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Huge Runtime",
      durationSec: null,
    });
  });

  it("reports no repair when the only answer is an unstorable runtime", async () => {
    requireDb();

    const videoId = videoIdFor("onlyhuge");
    await seedItem(videoId, { videoTitle: null, durationSec: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: null,
        durationSec: 3_599_999_996_400,
        aspectRatio: null,
      }),
    ).toBe(0);
    expect(await readItem(videoId)).toMatchObject({ videoTitle: null, durationSec: null });
  });

  it("strips a NUL byte out of a title rather than letting Postgres reject it", async () => {
    requireDb();

    const videoId = videoIdFor("nul");
    await seedItem(videoId, { videoTitle: null, durationSec: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Bad\u0000Title",
        durationSec: 90,
        aspectRatio: null,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({ videoTitle: "BadTitle", durationSec: 90 });
  });

  it("counts exactly the rows the repair would change, not every row for the video", async () => {
    requireDb();

    const videoId = videoIdFor("count");
    await seedItem(videoId, { videoTitle: null, durationSec: null });
    await seedItem(videoId, { videoTitle: "Already Named", durationSec: null });

    // Two rows carry this video, but the lookup can only name it, and one row
    // is already named: only the other one has a gap this answer can fill.
    const facts = { title: "Found Title", durationSec: null, aspectRatio: null };
    expect(await countRepairableRows(videoId, facts)).toBe(1);
    expect(await repairVideoFactsForVideo(videoId, facts)).toBe(1);
  });

  it("fills a frame shape the lookup answered, on a row that has nothing else missing", async () => {
    requireDb();

    const videoId = videoIdFor("shape");
    await seedItem(videoId, { videoTitle: "Named", durationSec: 300, aspectRatio: null });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: null,
        durationSec: null,
        aspectRatio: 0.5625,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Named",
      durationSec: 300,
      aspectRatio: 0.5625,
    });
  });

  it("never overwrites a frame shape another writer already filled", async () => {
    requireDb();

    const videoId = videoIdFor("shapekeep");
    await seedItem(videoId, { videoTitle: null, durationSec: null, aspectRatio: 1.3333 });

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Later Title",
        durationSec: null,
        aspectRatio: 1.7778,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Later Title",
      aspectRatio: 1.3333,
    });
  });

  it("reports no repair when the row's only gap is a frame shape the lookup could not answer", async () => {
    requireDb();

    const videoId = videoIdFor("shapenone");
    await seedItem(videoId, { videoTitle: "Named", durationSec: 300, aspectRatio: null });
    const before = await readItem(videoId);

    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Named",
        durationSec: 300,
        aspectRatio: null,
      }),
    ).toBe(0);

    const after = await readItem(videoId);
    expect(after).toMatchObject({ aspectRatio: null });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("drops a frame shape the column cannot hold instead of failing the write", async () => {
    requireDb();

    const videoId = videoIdFor("badshape");
    await seedItem(videoId, { videoTitle: null, durationSec: null, aspectRatio: null });

    // A ratio divided out of a zero height. The check constraint rejects it and
    // would take the whole statement down with it.
    expect(
      await repairVideoFactsForVideo(videoId, {
        title: "Kept Title",
        durationSec: null,
        aspectRatio: Number.POSITIVE_INFINITY,
      }),
    ).toBe(1);
    expect(await readItem(videoId)).toMatchObject({
      videoTitle: "Kept Title",
      aspectRatio: null,
    });
  });

  it("counts a frame shape gap the same way the repair fills it", async () => {
    requireDb();

    const videoId = videoIdFor("shapecount");
    await seedItem(videoId, { videoTitle: "Named", durationSec: 300, aspectRatio: null });
    await seedItem(videoId, { videoTitle: "Named", durationSec: 300, aspectRatio: 1.7778 });

    const facts = { title: null, durationSec: null, aspectRatio: 0.5625 };
    expect(await countRepairableRows(videoId, facts)).toBe(1);
    expect(await repairVideoFactsForVideo(videoId, facts)).toBe(1);
  });
});

describe("parseArgs", () => {
  it("accepts a bare invocation and the documented --dry-run flag", () => {
    expect(parseArgs([])).toEqual({ ok: true, isDryRun: false, isProd: false });
    expect(parseArgs(["--dry-run"])).toEqual({ ok: true, isDryRun: true, isProd: false });
  });

  it("accepts --prod and --dry-run in any combination", () => {
    expect(parseArgs(["--prod"])).toEqual({ ok: true, isDryRun: false, isProd: true });
    expect(parseArgs(["--prod", "--dry-run"])).toEqual({ ok: true, isDryRun: true, isProd: true });
    expect(parseArgs(["--dry-run", "--prod"])).toEqual({ ok: true, isDryRun: true, isProd: true });
  });

  it.each([
    "--dryrun",
    "--dry_run",
    "--DRY-RUN",
    "-d",
    "dry-run",
    "--production",
    "--PROD",
    "-p",
    "prod",
  ])(
    "refuses %s rather than silently running a live pass",
    (arg) => {
      const parsed = parseArgs([arg]);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok === false && parsed.error).toContain(arg);
      expect(parsed.ok === false && parsed.error).toContain("Usage:");
    },
  );

  it("names only the first offending argument alongside the accepted flag", () => {
    const parsed = parseArgs(["--dry-run", "--force"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("--force");
  });

  it("refuses an unknown argument even when --prod is also given", () => {
    const parsed = parseArgs(["--prod", "--dryrun"]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("--dryrun");
  });
});

describe("resolveRunEnv", () => {
  const devUrl = "postgres://dev:pw@ep-dev-123.us-east-2.aws.neon.tech/brief";
  const prodUrl = "postgres://prod:pw@ep-prod-456.us-east-2.aws.neon.tech/brief";
  const devEnv = { POSTGRES_URL: devUrl, YOUTUBE_API_KEY: "yt-key" };
  const prodEnv = { POSTGRES_URL: prodUrl };

  it("takes the database URL only from .env.production in --prod mode", () => {
    expect(resolveRunEnv(true, { env: devEnv, production: prodEnv })).toEqual({
      ok: true,
      environment: "PRODUCTION",
      postgresUrl: prodUrl,
      dbHost: "ep-prod-456.us-east-2.aws.neon.tech",
      youtubeApiKey: "yt-key",
    });
  });

  it("refuses --prod when .env.production has no POSTGRES_URL instead of falling back to .env", () => {
    const resolved = resolveRunEnv(true, { env: devEnv, production: {} });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain(".env.production");
  });

  it("refuses --prod when .env.production does not exist", () => {
    const resolved = resolveRunEnv(true, { env: devEnv, production: null });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain(".env.production");
  });

  it("still takes the YouTube key from .env in --prod mode, never from .env.production", () => {
    const resolved = resolveRunEnv(true, {
      env: { YOUTUBE_API_KEY: "dev-file-key" },
      production: { POSTGRES_URL: prodUrl, YOUTUBE_API_KEY: "prod-file-key" },
    });
    expect(resolved.ok && resolved.youtubeApiKey).toBe("dev-file-key");
  });

  it("uses the .env database URL without --prod", () => {
    expect(resolveRunEnv(false, { env: devEnv, production: null })).toEqual({
      ok: true,
      environment: "local",
      postgresUrl: devUrl,
      dbHost: "ep-dev-123.us-east-2.aws.neon.tech",
      youtubeApiKey: "yt-key",
    });
  });

  it("never takes the database URL from .env.production without --prod", () => {
    const resolved = resolveRunEnv(false, {
      env: { YOUTUBE_API_KEY: "yt-key" },
      production: prodEnv,
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain("POSTGRES_URL not found in .env");
  });

  it.each([
    ["the same host", prodUrl],
    ["the pooled host of the same endpoint", "postgres://x:pw@ep-prod-456-pooler.us-east-2.aws.neon.tech/brief"],
  ])("refuses a run without --prod whose .env points at %s as .env.production", (_label, url) => {
    const resolved = resolveRunEnv(false, {
      env: { POSTGRES_URL: url, YOUTUBE_API_KEY: "yt-key" },
      production: prodEnv,
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain("--prod");
  });

  it("refuses a POSTGRES_URL that is not a connection URL, naming the file it came from", () => {
    const resolved = resolveRunEnv(true, {
      env: devEnv,
      production: { POSTGRES_URL: "not a url" },
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain(".env.production");
  });

  it.each([
    ["absent", {}],
    ["blank", { YOUTUBE_API_KEY: "   " }],
  ])("refuses a run whose YouTube key is %s", (_label, keyFields) => {
    const resolved = resolveRunEnv(false, {
      env: { POSTGRES_URL: devUrl, ...keyFields },
      production: null,
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain("YOUTUBE_API_KEY");
  });

  it("refuses a run when .env does not exist", () => {
    const resolved = resolveRunEnv(true, { env: null, production: prodEnv });
    expect(resolved.ok).toBe(false);
    expect(resolved.ok === false && resolved.error).toContain(".env");
  });
});

describe("describeRepair", () => {
  const allFacts = { title: "Named", durationSec: 300, aspectRatio: 1.7778 };

  function pending(missing: { titles: number; durations: number; shapes: number }) {
    return {
      videoId: "describexx",
      rowCount: 2,
      missingTitles: missing.titles,
      missingDurations: missing.durations,
      missingAspectRatios: missing.shapes,
    };
  }

  it("names only the fields this run fills, not facts the rows already have", () => {
    const video = pending({ titles: 0, durations: 2, shapes: 0 });
    expect(describeRepair(video, allFacts, 2, false)).toBe("set runtime 300s on 2 row(s)");
  });

  it("names the same fields on the dry run's would-set line", () => {
    const video = pending({ titles: 1, durations: 0, shapes: 1 });
    expect(describeRepair(video, allFacts, 2, true)).toBe(
      'would set title "Named", frame shape 1.7778 on 2 row(s)',
    );
  });

  it("leaves out a missing field the lookup could not answer", () => {
    const video = pending({ titles: 2, durations: 2, shapes: 2 });
    expect(
      describeRepair(video, { title: "Named", durationSec: null, aspectRatio: null }, 2, false),
    ).toBe('set title "Named" on 2 row(s)');
  });

  it("leaves out a value the column cannot hold", () => {
    const video = pending({ titles: 2, durations: 2, shapes: 2 });
    expect(
      describeRepair(
        video,
        { title: "Named", durationSec: 3_599_999_996_400, aspectRatio: Number.NaN },
        2,
        false,
      ),
    ).toBe('set title "Named" on 2 row(s)');
  });

  it("keeps the note about rows the run left unchanged", () => {
    const video = pending({ titles: 1, durations: 0, shapes: 0 });
    expect(describeRepair(video, allFacts, 1, true)).toBe(
      'would set title "Named" on 1 row(s) (1 row(s) unchanged: nothing this lookup can fill there, or another writer already filled it)',
    );
  });

  it.each([
    [false, "set nothing (the lookup answered none of the fields these rows are missing)"],
    [true, "would set nothing (the lookup answered none of the fields these rows are missing)"],
  ])("says it sets nothing when the lookup answered no missing field (dry run %s)", (isDryRun, line) => {
    const video = pending({ titles: 2, durations: 0, shapes: 0 });
    expect(
      describeRepair(video, { title: null, durationSec: 300, aspectRatio: 1.7778 }, 0, isDryRun),
    ).toBe(line);
  });
});

describe("isConfirmed", () => {
  it("accepts exactly yes", () => {
    expect(isConfirmed("yes")).toBe(true);
  });

  it.each(["", "y", "YES", "Yes", " yes", "yes ", "yes please", "no"])(
    "refuses %j",
    (answer) => {
      expect(isConfirmed(answer)).toBe(false);
    },
  );
});

describe("repairOneVideo", () => {
  const video = {
    videoId: "onevideoxx",
    rowCount: 2,
    missingTitles: 2,
    missingDurations: 2,
    missingAspectRatios: 2,
  };

  it("returns the rows the write changed", async () => {
    const outcome = await repairOneVideo(video, false, {
      resolve: async () => ({ facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 } }),
      count: async () => {
        throw new Error("the counter belongs to the dry run only");
      },
      write: async () => 2,
    });
    expect(outcome).toEqual({
      kind: "repaired",
      facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 },
      rowsUpdated: 2,
    });
  });

  it("turns a failed write into an unresolved video instead of ending the run", async () => {
    const outcome = await repairOneVideo(video, false, {
      resolve: async () => ({ facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 } }),
      count: async () => {
        throw new Error("the counter belongs to the dry run only");
      },
      write: async () => {
        throw new Error('value "3599999996400" is out of range for type integer');
      },
    });
    expect(outcome.kind).toBe("unresolved");
    expect(outcome.kind === "unresolved" && outcome.reason).toContain("out of range");
  });

  it("does not write at all in a dry run", async () => {
    let writes = 0;
    const outcome = await repairOneVideo(video, true, {
      resolve: async () => ({ facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 } }),
      count: async () => 2,
      write: async () => {
        writes += 1;
        return 2;
      },
    });
    expect(writes).toBe(0);
    expect(outcome).toEqual({
      kind: "repaired",
      facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 },
      rowsUpdated: 2,
    });
  });

  it("reports the counted rows in a dry run, not every row for the video", async () => {
    let writes = 0;
    const outcome = await repairOneVideo(video, true, {
      resolve: async () => ({ facts: { title: "Named", durationSec: null, aspectRatio: null } }),
      count: async () => 1,
      write: async () => {
        writes += 1;
        return 2;
      },
    });
    expect(writes).toBe(0);
    expect(outcome).toEqual({
      kind: "repaired",
      facts: { title: "Named", durationSec: null, aspectRatio: null },
      rowsUpdated: 1,
    });
  });

  it("turns a failed count into an unresolved video instead of ending the dry run", async () => {
    const outcome = await repairOneVideo(video, true, {
      resolve: async () => ({ facts: { title: "Named", durationSec: 120, aspectRatio: 1.7778 } }),
      count: async () => {
        throw new Error("terminating connection due to administrator command");
      },
      write: async () => 2,
    });
    expect(outcome.kind).toBe("unresolved");
    expect(outcome.kind === "unresolved" && outcome.reason).toContain("terminating connection");
  });

  it("passes an unresolvable lookup through without attempting a write", async () => {
    let writes = 0;
    const outcome = await repairOneVideo(video, false, {
      resolve: async () => ({ reason: "YouTube refused the request" }),
      count: async () => {
        throw new Error("the counter belongs to the dry run only");
      },
      write: async () => {
        writes += 1;
        return 2;
      },
    });
    expect(writes).toBe(0);
    expect(outcome).toEqual({ kind: "unresolved", reason: "YouTube refused the request" });
  });

  it("turns a throwing lookup into an unresolved video instead of ending the run", async () => {
    let writes = 0;
    const outcome = await repairOneVideo(video, false, {
      resolve: async () => {
        throw new Error("fetch failed: getaddrinfo ENOTFOUND www.googleapis.com");
      },
      count: async () => {
        throw new Error("the counter belongs to the dry run only");
      },
      write: async () => {
        writes += 1;
        return 2;
      },
    });
    expect(writes).toBe(0);
    expect(outcome.kind).toBe("unresolved");
    expect(outcome.kind === "unresolved" && outcome.reason).toContain("ENOTFOUND");
  });

  it("turns a throwing lookup into an unresolved video in a dry run too", async () => {
    const outcome = await repairOneVideo(video, true, {
      resolve: async () => {
        throw new Error("quotaExceeded");
      },
      count: async () => 2,
      write: async () => 2,
    });
    expect(outcome.kind).toBe("unresolved");
    expect(outcome.kind === "unresolved" && outcome.reason).toContain("quotaExceeded");
  });
});
