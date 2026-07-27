#!/usr/bin/env tsx
/**
 * Collection Item Video Facts Repair
 *
 * Fills in `collection_items.video_title` and `collection_items.duration_sec`
 * for rows that still have none, by reading each video's current title and
 * runtime from YouTube.
 *
 * One tool for both fields because one YouTube response carries both: splitting
 * the repair in two would double the cost of learning the same facts. That cost
 * is two quota units per video, not one, because the shared `fetchMetadata` also
 * requests a pinned comment this repair never reads. Each field is repaired
 * independently, so a video that answers with a runtime but no title still heals
 * half the row.
 *
 * This is a standing repair tool, not a one-shot migration. Facts are only
 * resolved when an item is created or its video changes, so any lookup that
 * failed at write time (YouTube outage, exhausted quota, an unset API key)
 * leaves a NULL behind that never heals on its own. Re-run this whenever that
 * happens: it only ever writes a field that is still NULL with a fact the
 * lookup actually returned, so a row it cannot help is neither touched nor
 * counted, and running it twice in a row is a no-op the second time.
 *
 * Usage: pnpm backfill-video-facts [--dry-run]
 *
 * Local-only by design. Reads POSTGRES_URL and YOUTUBE_API_KEY from
 * apps/web/.env, and does NOT accept a --prod flag; running this against
 * production should happen through the Vercel/Neon dashboard, not from a
 * local shell.
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { fetchYouTubeVideoFacts, type YouTubeVideoFacts } from "../src/lib/video-facts";
import { storableVideoFacts } from "../src/lib/storable-video-facts";

export interface PendingVideo {
  videoId: string;
  rowCount: number;
  missingTitles: number;
  missingDurations: number;
}

interface RepairedVideo extends PendingVideo {
  facts: YouTubeVideoFacts;
  rowsUpdated: number;
}

interface UnresolvedVideo extends PendingVideo {
  reason: string;
}

interface RemainingGaps {
  missingTitles: number;
  missingDurations: number;
}

export type ParsedArgs = { ok: true; isDryRun: boolean } | { ok: false; error: string };

const USAGE = "Usage: pnpm backfill-video-facts [--dry-run]";

/**
 * Reads the command line, refusing anything it does not recognise.
 *
 * Failing closed is the whole point: this tool's only flag asks it NOT to write,
 * so a near miss like `--dryrun` or `--DRY-RUN` that was quietly ignored would
 * run a live pass against the database on behalf of an operator who asked for
 * the opposite.
 */
export function parseArgs(args: string[]): ParsedArgs {
  let isDryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      isDryRun = true;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}\n${USAGE}` };
  }
  return { ok: true, isDryRun };
}

/**
 * Resolves one video's facts, converting every outcome into a value.
 *
 * `fetchYouTubeVideoFacts` is documented as total, and the catch keeps that
 * promise enforced here: a single unresolvable video must never end the run
 * and strand the videos queued behind it.
 *
 * The answer is reduced to what the columns can hold before anything else sees
 * it, so the log, the dry run, and the write all describe the same facts, and a
 * value YouTube can report but Postgres cannot store reads as the gap it is.
 */
async function resolveFacts(
  videoId: string,
): Promise<{ facts: YouTubeVideoFacts } | { reason: string }> {
  try {
    const facts = storableVideoFacts(await fetchYouTubeVideoFacts(videoId));
    if (facts.title === null && facts.durationSec === null) {
      return {
        reason:
          "YouTube returned no storable title and no storable runtime (video may be private, deleted, live, or the API refused the request)",
      };
    }
    return { facts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reason: `Lookup threw: ${message}` };
  }
}

/**
 * Writes whichever facts this lookup can actually fill into every row for one
 * video, and answers with the number of rows it changed.
 *
 * The IS NULL guards are repeated here rather than trusted from the SELECT that
 * chose the video, and applied per field, so a value written by another writer
 * in between wins over this run's. The same guards appear in the WHERE, paired
 * with the fact this run holds, so a row whose only remaining gap is one the
 * lookup could not answer is not matched at all: it keeps its `updated_at`, and
 * it is not counted as repaired.
 *
 * Facts are reduced to what the columns can hold on the way in. This is the
 * statement that interpolates them, so it is the boundary that has to enforce
 * it, whoever supplied them and whatever the caller has already checked.
 */
export async function repairVideoFactsForVideo(
  videoId: string,
  unstorableFacts: YouTubeVideoFacts,
): Promise<number> {
  const facts = storableVideoFacts(unstorableFacts);
  const result = await sql`
    UPDATE collection_items
    SET video_title = CASE
          WHEN video_title IS NULL THEN ${facts.title}::text
          ELSE video_title
        END,
        duration_sec = CASE
          WHEN duration_sec IS NULL THEN ${facts.durationSec}::int
          ELSE duration_sec
        END,
        updated_at = NOW()
    WHERE video_id = ${videoId}
      AND (
        (video_title IS NULL AND ${facts.title}::text IS NOT NULL)
        OR (duration_sec IS NULL AND ${facts.durationSec}::int IS NOT NULL)
      )
  `;
  return result.rowCount ?? 0;
}

/**
 * Answers how many rows this lookup would actually change, for a dry run to
 * report.
 *
 * The predicate is the repair's own WHERE clause, and the facts are reduced the
 * same way before it runs, so the number is the write's number rather than an
 * estimate. Neither the video's row count nor any arithmetic over
 * `missingTitles` and `missingDurations` can stand in for it: a lookup that can
 * only fill one of the two fields leaves every row whose gap is the other one
 * untouched, and the overlap between the two gap counts is not known here.
 */
export async function countRepairableRows(
  videoId: string,
  unstorableFacts: YouTubeVideoFacts,
): Promise<number> {
  const facts = storableVideoFacts(unstorableFacts);
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int as "count"
    FROM collection_items
    WHERE video_id = ${videoId}
      AND (
        (video_title IS NULL AND ${facts.title}::text IS NOT NULL)
        OR (duration_sec IS NULL AND ${facts.durationSec}::int IS NOT NULL)
      )
  `;
  return result.rows[0]?.count ?? 0;
}

export type VideoOutcome =
  | { kind: "repaired"; facts: YouTubeVideoFacts; rowsUpdated: number }
  | { kind: "unresolved"; reason: string };

/**
 * The three fallible steps one video needs: reading its facts, counting the
 * rows they would repair, and writing them. Named as a seam so the loop's
 * failure handling can be exercised without a YouTube key or a database.
 */
export interface RepairDeps {
  resolve: (videoId: string) => Promise<{ facts: YouTubeVideoFacts } | { reason: string }>;
  count: (videoId: string, facts: YouTubeVideoFacts) => Promise<number>;
  write: (videoId: string, facts: YouTubeVideoFacts) => Promise<number>;
}

const LIVE_DEPS: RepairDeps = {
  resolve: resolveFacts,
  count: countRepairableRows,
  write: repairVideoFactsForVideo,
};

/**
 * Carries one video from "incomplete" to an outcome, converting every failure
 * into a value.
 *
 * A dry run counts the rows the write would change instead of writing them, so
 * it reports the same number the live pass would and still touches nothing.
 *
 * Every step is inside the catch, the lookup as much as the statement. A lookup
 * can reject rather than report a reason, and a statement can be rejected after
 * a lookup succeeded; an escaping error from either would end the whole run and
 * strand every video queued behind this one, which is the exact failure the
 * per-video isolation exists to prevent. `step` names whichever one failed so
 * the reported reason still says where.
 */
export async function repairOneVideo(
  video: PendingVideo,
  isDryRun: boolean,
  deps: RepairDeps = LIVE_DEPS,
): Promise<VideoOutcome> {
  let step: "Lookup" | "Count" | "Write" = "Lookup";
  try {
    const outcome = await deps.resolve(video.videoId);
    if ("reason" in outcome) return { kind: "unresolved", reason: outcome.reason };

    step = isDryRun ? "Count" : "Write";
    const rowsUpdated = isDryRun
      ? await deps.count(video.videoId, outcome.facts)
      : await deps.write(video.videoId, outcome.facts);
    return { kind: "repaired", facts: outcome.facts, rowsUpdated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unresolved", reason: `${step} failed: ${message}` };
  }
}

function describeFacts(facts: YouTubeVideoFacts): string {
  const parts: string[] = [];
  parts.push(facts.title === null ? "no title" : `title "${facts.title}"`);
  parts.push(facts.durationSec === null ? "no runtime" : `runtime ${facts.durationSec}s`);
  return parts.join(", ");
}

async function countRemainingGaps(): Promise<RemainingGaps> {
  const result = await sql<RemainingGaps>`
    SELECT
      COUNT(*) FILTER (WHERE video_title IS NULL)::int as "missingTitles",
      COUNT(*) FILTER (WHERE duration_sec IS NULL)::int as "missingDurations"
    FROM collection_items
  `;
  return result.rows[0] ?? { missingTitles: 0, missingDurations: 0 };
}

async function runBackfill() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`\nError: ${parsed.error}\n`);
    process.exit(1);
  }
  const { isDryRun } = parsed;
  const envPath = path.join(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    console.error(`Error: Environment file not found: ${envPath}`);
    process.exit(1);
  }

  config({ path: envPath });

  console.log(`\n🏷️  Collection Video Facts Backfill`);
  console.log(`   Environment: local`);
  if (isDryRun) {
    console.log(`   Mode:        DRY RUN (no changes will be made)`);
  }

  if (!process.env.POSTGRES_URL) {
    console.error(`\nError: POSTGRES_URL not found in .env\n`);
    process.exit(1);
  }

  let dbHost: string;
  try {
    dbHost = new URL(process.env.POSTGRES_URL).host;
  } catch {
    console.error(`\nError: POSTGRES_URL in .env is not a valid connection URL\n`);
    process.exit(1);
  }
  console.log(`   Database:    ${dbHost}`);
  console.log();

  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    console.error("Error: YOUTUBE_API_KEY not found in .env.");
    console.error("Every lookup would fail without it; set the key and re-run.\n");
    process.exit(1);
  }

  try {
    const before = await countRemainingGaps();

    const pendingResult = await sql<PendingVideo>`
      SELECT
        video_id as "videoId",
        COUNT(*)::int as "rowCount",
        COUNT(*) FILTER (WHERE video_title IS NULL)::int as "missingTitles",
        COUNT(*) FILTER (WHERE duration_sec IS NULL)::int as "missingDurations"
      FROM collection_items
      WHERE video_title IS NULL OR duration_sec IS NULL
      GROUP BY video_id
      ORDER BY video_id
    `;

    const pending = pendingResult.rows;
    const rowsConsidered = pending.reduce((total, video) => total + video.rowCount, 0);

    console.log(
      `Before: ${before.missingTitles} row(s) missing a title, ${before.missingDurations} missing a runtime`
    );
    console.log(
      `Found ${rowsConsidered} incomplete row(s) across ${pending.length} distinct video id(s)\n`
    );

    if (pending.length === 0) {
      console.log("Nothing to repair. Every collection item has a title and a runtime.\n");
      process.exit(0);
    }

    const repaired: RepairedVideo[] = [];
    const unresolved: UnresolvedVideo[] = [];

    // Sequential on purpose: a handful of lookups is not worth spending a
    // burst of YouTube quota on, and it keeps the log readable in order.
    for (const [index, video] of pending.entries()) {
      const label = `[${index + 1}/${pending.length}] ${video.videoId} (${video.rowCount} row(s))`;
      const outcome = await repairOneVideo(video, isDryRun);

      if (outcome.kind === "unresolved") {
        unresolved.push({ ...video, reason: outcome.reason });
        console.log(`${label}: UNRESOLVED. ${outcome.reason}`);
        continue;
      }

      repaired.push({ ...video, facts: outcome.facts, rowsUpdated: outcome.rowsUpdated });

      const skipped = video.rowCount - outcome.rowsUpdated;
      const skippedNote =
        skipped > 0
          ? ` (${skipped} row(s) unchanged: nothing this lookup can fill there, or another writer already filled it)`
          : "";

      if (isDryRun) {
        console.log(
          `${label}: would set ${describeFacts(outcome.facts)} on ${outcome.rowsUpdated} row(s)${skippedNote}`
        );
        continue;
      }

      console.log(
        `${label}: set ${describeFacts(outcome.facts)} on ${outcome.rowsUpdated} row(s)${skippedNote}`
      );
    }

    const rowsAffected = repaired.reduce((total, video) => total + video.rowsUpdated, 0);
    const rowsMissed = unresolved.reduce((total, video) => total + video.rowCount, 0);
    const after = isDryRun ? before : await countRemainingGaps();

    console.log();
    console.log("Summary");
    console.log(`  Rows considered:   ${rowsConsidered}`);
    console.log(`  Distinct videos:   ${pending.length}`);
    console.log(`  Videos resolved:   ${repaired.length}`);
    console.log(`  Videos unresolved: ${unresolved.length}`);
    console.log(
      `  ${isDryRun ? "Rows that would be updated:" : "Rows updated:             "} ${rowsAffected}`
    );
    console.log(
      `  Titles missing:    ${before.missingTitles} -> ${after.missingTitles}${isDryRun ? " (unchanged, dry run)" : ""}`
    );
    console.log(
      `  Runtimes missing:  ${before.missingDurations} -> ${after.missingDurations}${isDryRun ? " (unchanged, dry run)" : ""}`
    );

    if (unresolved.length > 0) {
      console.log(`\nUnresolved (${rowsMissed} row(s) left incomplete):`);
      for (const video of unresolved) {
        console.log(`  - ${video.videoId} (${video.rowCount} row(s)): ${video.reason}`);
      }
      console.log(
        "\nThese rows stay NULL. Re-run this script once the videos are reachable again."
      );
    }

    console.log();
    if (isDryRun) {
      console.log("Dry run complete. No changes were made.\n");
    } else {
      console.log("Backfill complete.\n");
    }

    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

/**
 * Only the shell invocation runs the backfill. Importing this module (the tests
 * for the repair statement do) must not start writing to a database.
 */
function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  runBackfill();
}
