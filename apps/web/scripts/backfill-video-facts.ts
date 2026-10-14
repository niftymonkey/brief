#!/usr/bin/env tsx
/**
 * Collection Item Video Facts Repair
 *
 * Fills in `collection_items.video_title`, `collection_items.duration_sec` and
 * `collection_items.aspect_ratio` for rows that still have none, by reading each
 * video's current title, runtime and frame shape from YouTube.
 *
 * One tool for all three fields because one YouTube response carries all three:
 * splitting the repair up would multiply the cost of learning the same facts.
 * That cost is two quota units per video, not one, because the shared
 * `fetchMetadata` also requests a pinned comment this repair never reads. Each
 * field is repaired independently, so a video that answers with a runtime but no
 * title still heals part of the row.
 *
 * This is a standing repair tool, not a one-shot migration. Facts are only
 * resolved when an item is created or its video changes, so any lookup that
 * failed at write time (YouTube outage, exhausted quota, an unset API key)
 * leaves a NULL behind that never heals on its own. Re-run this whenever that
 * happens: it only ever writes a field that is still NULL with a fact the
 * lookup actually returned, so a row it cannot help is neither touched nor
 * counted, and running it twice in a row is a no-op the second time.
 *
 * Usage: pnpm backfill-video-facts [--prod] [--dry-run]
 *
 * Without --prod it runs against the database named by POSTGRES_URL in
 * apps/web/.env, and refuses to start if that URL points at the same host as
 * apps/web/.env.production. With --prod the database URL comes from
 * apps/web/.env.production and nowhere else, and the run prints the target
 * host and waits for the operator to type `yes` before its first query, dry run
 * included. YOUTUBE_API_KEY always comes from apps/web/.env, because
 * .env.production holds only database settings. Both files are parsed
 * explicitly and their values assigned over whatever the shell already
 * exported, so no other file or variable can choose the database.
 */

import { parse } from "dotenv";
import { sql } from "@vercel/postgres";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { fetchYouTubeVideoFacts, type YouTubeVideoFacts } from "../src/lib/video-facts";
import { storableVideoFacts } from "../src/lib/storable-video-facts";

export interface PendingVideo {
  videoId: string;
  rowCount: number;
  missingTitles: number;
  missingDurations: number;
  missingAspectRatios: number;
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
  missingAspectRatios: number;
}

export type ParsedArgs =
  | { ok: true; isDryRun: boolean; isProd: boolean }
  | { ok: false; error: string };

const USAGE = "Usage: pnpm backfill-video-facts [--prod] [--dry-run]";

/**
 * Reads the command line, refusing anything it does not recognise.
 *
 * Failing closed is the whole point. `--dry-run` asks the tool NOT to write, so
 * a near miss like `--dryrun` or `--DRY-RUN` that was quietly ignored would run
 * a live pass on behalf of an operator who asked for the opposite, and a near
 * miss of `--prod` quietly ignored would aim a run meant for production at
 * whatever database .env names.
 */
export function parseArgs(args: string[]): ParsedArgs {
  let isDryRun = false;
  let isProd = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      isDryRun = true;
      continue;
    }
    if (arg === "--prod") {
      isProd = true;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}\n${USAGE}` };
  }
  return { ok: true, isDryRun, isProd };
}

/** The parsed contents of the env files a run may read; `null` when absent. */
export interface EnvFiles {
  env: Record<string, string> | null;
  production: Record<string, string> | null;
}

export type RunEnv =
  | {
      ok: true;
      environment: "PRODUCTION" | "local";
      postgresUrl: string;
      dbHost: string;
      youtubeApiKey: string;
    }
  | { ok: false; error: string };

/**
 * Treats a Neon pooled host and its direct host as the same database, since
 * they name one endpoint.
 */
function databaseIdentity(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace("-pooler.", ".");
  } catch {
    return null;
  }
}

/**
 * Chooses the database and the YouTube key for a run, from the env files alone.
 *
 * With --prod the database URL is read from .env.production and never from
 * .env, so a production run that finds no production URL stops instead of
 * falling back to the development one. Without --prod it is read from .env and
 * never from .env.production, and a .env that points at production's host is
 * refused, so production is only ever reached by asking for it. The YouTube key
 * comes from .env in both modes.
 */
export function resolveRunEnv(isProd: boolean, files: EnvFiles): RunEnv {
  const dbFile = isProd ? ".env.production" : ".env";
  const dbVars = isProd ? files.production : files.env;

  if (dbVars === null) {
    return {
      ok: false,
      error: isProd
        ? "Environment file not found: .env.production\nCreate .env.production with your production POSTGRES_URL"
        : "Environment file not found: .env",
    };
  }

  const postgresUrl = dbVars.POSTGRES_URL?.trim();
  if (!postgresUrl) {
    return { ok: false, error: `POSTGRES_URL not found in ${dbFile}` };
  }

  let dbHost: string;
  try {
    dbHost = new URL(postgresUrl).host;
  } catch {
    return { ok: false, error: `POSTGRES_URL in ${dbFile} is not a valid connection URL` };
  }

  if (!isProd && files.production?.POSTGRES_URL) {
    const productionIdentity = databaseIdentity(files.production.POSTGRES_URL);
    if (productionIdentity !== null && productionIdentity === databaseIdentity(postgresUrl)) {
      return {
        ok: false,
        error:
          "POSTGRES_URL in .env points at the same database host as .env.production.\nPass --prod to run against production.",
      };
    }
  }

  if (files.env === null) {
    return {
      ok: false,
      error: "Environment file not found: .env (YOUTUBE_API_KEY is read from it)",
    };
  }

  const youtubeApiKey = files.env.YOUTUBE_API_KEY?.trim();
  if (!youtubeApiKey) {
    return {
      ok: false,
      error:
        "YOUTUBE_API_KEY not found in .env.\nEvery lookup would fail without it; set the key and re-run.",
    };
  }

  return {
    ok: true,
    environment: isProd ? "PRODUCTION" : "local",
    postgresUrl,
    dbHost,
    youtubeApiKey,
  };
}

/** Only the exact word goes ahead; anything else, including silence, cancels. */
export function isConfirmed(answer: string): boolean {
  return answer === "yes";
}

/**
 * Asks the operator to confirm a production run. A closed stdin answers no,
 * so a piped or detached invocation cancels rather than hanging or proceeding.
 */
async function confirmProduction(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve(false);
    });
    rl.question(
      "\n⚠️  WARNING: You are about to run the video facts backfill on PRODUCTION!\n" +
        "Type 'yes' to confirm: ",
      (answer) => {
        answered = true;
        rl.close();
        resolve(isConfirmed(answer));
      }
    );
  });
}

function readEnvFile(fileName: string): Record<string, string> | null {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return null;
  return parse(fs.readFileSync(filePath));
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
    if (facts.title === null && facts.durationSec === null && facts.aspectRatio === null) {
      return {
        reason:
          "YouTube returned no storable title, runtime or frame shape (video may be private, deleted, live, or the API refused the request)",
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
        aspect_ratio = CASE
          WHEN aspect_ratio IS NULL THEN ${facts.aspectRatio}::double precision
          ELSE aspect_ratio
        END,
        updated_at = NOW()
    WHERE video_id = ${videoId}
      AND (
        (video_title IS NULL AND ${facts.title}::text IS NOT NULL)
        OR (duration_sec IS NULL AND ${facts.durationSec}::int IS NOT NULL)
        OR (aspect_ratio IS NULL AND ${facts.aspectRatio}::double precision IS NOT NULL)
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
 * `missingTitles`, `missingDurations` and `missingAspectRatios` can stand in for
 * it: a lookup that can only fill some of the fields leaves every row whose gaps
 * are the others untouched, and the overlap between the gap counts is not known
 * here.
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
        OR (aspect_ratio IS NULL AND ${facts.aspectRatio}::double precision IS NOT NULL)
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

/**
 * Describes what this run does to one video's rows, naming only the fields it
 * fills: a field counts when some row for the video is missing it and the
 * lookup answered it with a value the column can hold. A fact the rows already
 * have is not written, so naming it would claim a change that never happened.
 */
export function describeRepair(
  video: PendingVideo,
  unstorableFacts: YouTubeVideoFacts,
  rowsUpdated: number,
  isDryRun: boolean,
): string {
  const facts = storableVideoFacts(unstorableFacts);
  const verb = isDryRun ? "would set" : "set";

  const filled: string[] = [];
  if (video.missingTitles > 0 && facts.title !== null) {
    filled.push(`title "${facts.title}"`);
  }
  if (video.missingDurations > 0 && facts.durationSec !== null) {
    filled.push(`runtime ${facts.durationSec}s`);
  }
  if (video.missingAspectRatios > 0 && facts.aspectRatio !== null) {
    filled.push(`frame shape ${facts.aspectRatio}`);
  }

  if (filled.length === 0) {
    return `${verb} nothing (the lookup answered none of the fields these rows are missing)`;
  }

  const skipped = video.rowCount - rowsUpdated;
  const skippedNote =
    skipped > 0
      ? ` (${skipped} row(s) unchanged: nothing this lookup can fill there, or another writer already filled it)`
      : "";
  return `${verb} ${filled.join(", ")} on ${rowsUpdated} row(s)${skippedNote}`;
}

async function countRemainingGaps(): Promise<RemainingGaps> {
  const result = await sql<RemainingGaps>`
    SELECT
      COUNT(*) FILTER (WHERE video_title IS NULL)::int as "missingTitles",
      COUNT(*) FILTER (WHERE duration_sec IS NULL)::int as "missingDurations",
      COUNT(*) FILTER (WHERE aspect_ratio IS NULL)::int as "missingAspectRatios"
    FROM collection_items
  `;
  return result.rows[0] ?? { missingTitles: 0, missingDurations: 0, missingAspectRatios: 0 };
}

async function runBackfill() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`\nError: ${parsed.error}\n`);
    process.exit(1);
  }
  const { isDryRun, isProd } = parsed;

  const runEnv = resolveRunEnv(isProd, {
    env: readEnvFile(".env"),
    production: readEnvFile(".env.production"),
  });
  if (!runEnv.ok) {
    console.error(`\nError: ${runEnv.error}\n`);
    process.exit(1);
  }

  console.log(`\n🏷️  Collection Video Facts Backfill`);
  console.log(`   Environment: ${runEnv.environment}`);
  if (isDryRun) {
    console.log(`   Mode:        DRY RUN (no changes will be made)`);
  }
  console.log(`   Database:    ${runEnv.dbHost}`);
  console.log();

  if (isProd) {
    const confirmed = await confirmProduction();
    if (!confirmed) {
      console.log("\nBackfill cancelled.\n");
      process.exit(0);
    }
    console.log();
  }

  process.env.POSTGRES_URL = runEnv.postgresUrl;
  process.env.YOUTUBE_API_KEY = runEnv.youtubeApiKey;

  try {
    const before = await countRemainingGaps();

    const pendingResult = await sql<PendingVideo>`
      SELECT
        video_id as "videoId",
        COUNT(*)::int as "rowCount",
        COUNT(*) FILTER (WHERE video_title IS NULL)::int as "missingTitles",
        COUNT(*) FILTER (WHERE duration_sec IS NULL)::int as "missingDurations",
        COUNT(*) FILTER (WHERE aspect_ratio IS NULL)::int as "missingAspectRatios"
      FROM collection_items
      WHERE video_title IS NULL OR duration_sec IS NULL OR aspect_ratio IS NULL
      GROUP BY video_id
      ORDER BY video_id
    `;

    const pending = pendingResult.rows;
    const rowsConsidered = pending.reduce((total, video) => total + video.rowCount, 0);

    console.log(
      `Before: ${before.missingTitles} row(s) missing a title, ${before.missingDurations} missing a runtime, ${before.missingAspectRatios} missing a frame shape`
    );
    console.log(
      `Found ${rowsConsidered} incomplete row(s) across ${pending.length} distinct video id(s)\n`
    );

    if (pending.length === 0) {
      console.log(
        "Nothing to repair. Every collection item has a title, a runtime and a frame shape.\n"
      );
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
      console.log(
        `${label}: ${describeRepair(video, outcome.facts, outcome.rowsUpdated, isDryRun)}`
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
    console.log(
      `  Shapes missing:    ${before.missingAspectRatios} -> ${after.missingAspectRatios}${isDryRun ? " (unchanged, dry run)" : ""}`
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
