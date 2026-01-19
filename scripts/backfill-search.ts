#!/usr/bin/env tsx
/**
 * Backfill Search Text Script
 *
 * This script populates the search_text column for existing digests
 * Run this after the 004_add_full_text_search.sql migration
 *
 * Usage: pnpm backfill-search [--prod] [--dry-run]
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

interface DbDigest {
  id: string;
  title: string;
  summary: string;
  sections: ContentSection[];
  tangents: Tangent[] | null;
  relatedLinks: Link[];
  otherLinks: Link[];
}

interface ContentSection {
  title: string;
  keyPoints: KeyPoint[] | string[];
}

interface KeyPoint {
  text: string;
}

interface Tangent {
  title: string;
  summary: string;
}

interface Link {
  title: string;
  description: string;
}

function buildSearchText(digest: DbDigest): string {
  const parts: string[] = [];

  if (digest.summary) {
    parts.push(digest.summary);
  }

  for (const section of digest.sections || []) {
    if (section.title) {
      parts.push(section.title);
    }
    for (const kp of section.keyPoints || []) {
      if (typeof kp === "string") {
        parts.push(kp);
      } else {
        parts.push(kp.text);
      }
    }
  }

  if (digest.tangents) {
    for (const tangent of digest.tangents) {
      if (tangent.title) {
        parts.push(tangent.title);
      }
      if (tangent.summary) {
        parts.push(tangent.summary);
      }
    }
  }

  const allLinks = [...(digest.relatedLinks || []), ...(digest.otherLinks || [])];
  for (const link of allLinks) {
    if (link.title) {
      parts.push(link.title);
    }
    if (link.description) {
      parts.push(link.description);
    }
  }

  return parts.join(" ");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const isProd = args.includes("--prod");
  const isDryRun = args.includes("--dry-run");
  return { isProd, isDryRun };
}

async function confirmProduction(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  WARNING: You are about to backfill search data on PRODUCTION!\n" +
        "Type 'yes' to confirm: ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      }
    );
  });
}

async function runBackfill() {
  const { isProd, isDryRun } = parseArgs();
  const envFile = isProd ? ".env.production" : ".env";
  const envPath = path.join(process.cwd(), envFile);

  if (!fs.existsSync(envPath)) {
    console.error(`Error: Environment file not found: ${envFile}`);
    process.exit(1);
  }

  config({ path: envPath });

  const environment = isProd ? "PRODUCTION" : "local";
  console.log(`\n🔍 Search Text Backfill`);
  console.log(`   Environment: ${environment}`);
  if (isDryRun) {
    console.log(`   Mode:        DRY RUN (no changes will be made)`);
  }
  console.log();

  if (isProd && !isDryRun) {
    const confirmed = await confirmProduction();
    if (!confirmed) {
      console.log("\nBackfill cancelled.\n");
      process.exit(0);
    }
    console.log();
  }

  if (!process.env.POSTGRES_URL) {
    console.error(`Error: POSTGRES_URL not found in ${envFile}`);
    process.exit(1);
  }

  try {
    // Get all digests that need backfilling (where search_text is NULL)
    const digestsResult = await sql<DbDigest>`
      SELECT
        id,
        title,
        summary,
        sections,
        tangents,
        related_links as "relatedLinks",
        other_links as "otherLinks"
      FROM digests
      WHERE search_text IS NULL
    `;

    const digests = digestsResult.rows;
    console.log(`Found ${digests.length} digest(s) to backfill\n`);

    if (digests.length === 0) {
      console.log("Nothing to backfill. All digests have search_text populated.\n");
      process.exit(0);
    }

    let updated = 0;
    for (const digest of digests) {
      const searchText = buildSearchText(digest);

      if (isDryRun) {
        console.log(`[${updated + 1}/${digests.length}] Would update: ${digest.title.substring(0, 50)}...`);
        console.log(`   Search text length: ${searchText.length} chars`);
      } else {
        await sql`
          UPDATE digests
          SET search_text = ${searchText}
          WHERE id = ${digest.id}
        `;
        console.log(`[${updated + 1}/${digests.length}] Updated: ${digest.title.substring(0, 50)}...`);
      }
      updated++;
    }

    console.log();
    if (isDryRun) {
      console.log(`Dry run complete. Would have updated ${updated} digest(s).\n`);
    } else {
      console.log(`Backfill complete. Updated ${updated} digest(s).\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

runBackfill();
