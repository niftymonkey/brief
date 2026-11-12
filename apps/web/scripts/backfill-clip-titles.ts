#!/usr/bin/env tsx
/**
 * Clip title backfill: writes an AI title for every settled clip whose title
 * is still the AI's to write and was never written, leaving notes and status
 * alone. Safe to re-run: a clip that has a title is never listed again.
 *
 * Usage: pnpm backfill-clip-titles [--prod] [--dry-run]
 *
 * Without --prod the database comes from POSTGRES_URL in apps/web/.env, and a
 * .env pointing at production's host is refused. With --prod it comes from
 * apps/web/.env.production alone, and the run waits for a typed `yes` before
 * its first query, dry run included. OPENROUTER_API_KEY is read from .env.local,
 * then .env. SUPADATA_API_KEY, which picks the transcript source for videos the
 * owner never briefed, is read from the database's own env file, so each run
 * fetches transcripts the way that environment's server does. Values from the
 * files are assigned over whatever the shell exported.
 */

import { parse } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { listUntitledClips, type UntitledClip } from "../src/lib/collections";
import { backfillClipTitles, type ClipTitleOutcome } from "../src/lib/clip-title-backfill";
import { createClipWordsDeps } from "../src/lib/clip-words";

const USAGE = "Usage: pnpm backfill-clip-titles [--prod] [--dry-run]";

interface RunFlags {
  isDryRun: boolean;
  isProd: boolean;
}

interface RunEnv {
  environment: "PRODUCTION" | "local";
  postgresUrl: string;
  dbHost: string;
  openRouterKey: string;
  supadataKey: string | null;
}

/** Fails closed: a near miss of `--dry-run` or `--prod` must never run as something else. */
const parseFlags = (args: string[]): RunFlags => {
  const flags: RunFlags = { isDryRun: false, isProd: false };
  for (const arg of args) {
    if (arg === "--dry-run") flags.isDryRun = true;
    else if (arg === "--prod") flags.isProd = true;
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return flags;
};

const readEnvFile = (fileName: string): Record<string, string> | null => {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return null;
  return parse(fs.readFileSync(filePath));
};

/** A Neon pooled host and its direct host name one endpoint. */
const databaseIdentity = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace("-pooler.", ".");
  } catch {
    return null;
  }
};

const resolveRunEnv = (isProd: boolean): RunEnv => {
  const env = readEnvFile(".env");
  const production = readEnvFile(".env.production");
  const local = readEnvFile(".env.local");
  const dbFile = isProd ? ".env.production" : ".env";
  const dbVars = isProd ? production : env;
  if (dbVars === null) throw new Error(`Environment file not found: ${dbFile}`);

  const postgresUrl = dbVars.POSTGRES_URL?.trim();
  if (!postgresUrl) throw new Error(`POSTGRES_URL not found in ${dbFile}`);
  const identity = databaseIdentity(postgresUrl);
  if (identity === null) throw new Error(`POSTGRES_URL in ${dbFile} is not a valid connection URL`);

  const productionUrl = production?.POSTGRES_URL;
  if (!isProd && productionUrl && databaseIdentity(productionUrl) === identity) {
    throw new Error(
      "POSTGRES_URL in .env points at the same database host as .env.production.\nPass --prod to run against production.",
    );
  }

  const openRouterKey = (local?.OPENROUTER_API_KEY ?? env?.OPENROUTER_API_KEY)?.trim();
  if (!openRouterKey) throw new Error("OPENROUTER_API_KEY not found in .env.local or .env");

  return {
    environment: isProd ? "PRODUCTION" : "local",
    postgresUrl,
    dbHost: new URL(postgresUrl).host,
    openRouterKey,
    supadataKey: dbVars.SUPADATA_API_KEY?.trim() || null,
  };
};

/** Only the exact word goes ahead. A closed stdin answers no, so a piped run cancels. */
const confirmProduction = (): Promise<boolean> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve(false);
    });
    rl.question(
      "\nWARNING: You are about to run the clip title backfill on PRODUCTION.\nType 'yes' to confirm: ",
      (answer) => {
        answered = true;
        rl.close();
        resolve(answer === "yes");
      },
    );
  });
};

const applyRunEnv = (runEnv: RunEnv): void => {
  process.env.POSTGRES_URL = runEnv.postgresUrl;
  if (runEnv.supadataKey) process.env.SUPADATA_API_KEY = runEnv.supadataKey;
  else delete process.env.SUPADATA_API_KEY;
};

const printHeader = (runEnv: RunEnv, flags: RunFlags): void => {
  console.log("\nClip Title Backfill");
  console.log(`   Environment: ${runEnv.environment}`);
  if (flags.isDryRun) console.log("   Mode:        DRY RUN (no model calls, no writes)");
  console.log(`   Database:    ${runEnv.dbHost}\n`);
};

const clipLabel = (clip: UntitledClip, index: number, total: number): string =>
  `[${index + 1}/${total}] "${clip.collection.title}" (${clip.collection.id}) clip ${clip.item.id}`;

const describeOutcome = (outcome: ClipTitleOutcome): string => {
  if (outcome.kind === "written") return `titled "${outcome.title}"`;
  if (outcome.kind === "skipped") return `skipped, ${outcome.reason}`;
  return `FAILED, ${outcome.reason}`;
};

const listDryRun = (clips: UntitledClip[]): void => {
  for (const [index, clip] of clips.entries()) {
    const footage = clip.item.videoTitle ?? clip.item.videoId;
    console.log(`${clipLabel(clip, index, clips.length)}: would title (${footage}, owner ${clip.ownerId})`);
  }
  console.log(`\nDry run complete. ${clips.length} clip(s) would be titled. Nothing was called or written.\n`);
};

const titleClips = async (clips: UntitledClip[], openRouterKey: string): Promise<void> => {
  let index = 0;
  const tally = await backfillClipTitles(clips, createClipWordsDeps(openRouterKey), (clip, outcome) => {
    console.log(`${clipLabel(clip, index, clips.length)}: ${describeOutcome(outcome)}`);
    index += 1;
  });
  console.log(`\nDone. ${tally.written} titled, ${tally.skipped} skipped, ${tally.failed} failed.`);
  if (tally.failed > 0) console.log("Failed clips keep no title. Re-run once the cause is fixed.");
  console.log();
};

const main = async (): Promise<void> => {
  const flags = parseFlags(process.argv.slice(2));
  const runEnv = resolveRunEnv(flags.isProd);
  printHeader(runEnv, flags);

  if (flags.isProd && !(await confirmProduction())) {
    console.log("\nBackfill cancelled.\n");
    return;
  }

  applyRunEnv(runEnv);
  const clips = await listUntitledClips();
  console.log(`Found ${clips.length} settled clip(s) with no title.\n`);
  if (clips.length === 0) return;

  if (flags.isDryRun) listDryRun(clips);
  else await titleClips(clips, runEnv.openRouterKey);
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\nBackfill failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
