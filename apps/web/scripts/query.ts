#!/usr/bin/env tsx
/**
 * Local database query helper.
 *
 * Usage:
 *   pnpm query "SELECT id, title FROM digests LIMIT 3"
 *   pnpm query --pretty "SELECT id, transcript->'source' FROM digests LIMIT 1"
 *
 * Local-only by design — reads POSTGRES_URL from apps/web/.env. Does NOT
 * accept a --prod flag; running ad-hoc queries against production should
 * happen through the Vercel/Neon dashboard, not from a local shell.
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as path from "path";
import * as fs from "fs";

function parseArgs() {
  const argv = process.argv.slice(2);
  const pretty = argv.includes("--pretty");
  const queryParts = argv.filter((a) => !a.startsWith("--"));
  const query = queryParts.join(" ").trim();
  return { query, pretty };
}

async function main() {
  const { query, pretty } = parseArgs();
  if (!query) {
    console.error("Usage: pnpm query \"<SQL>\"  [--pretty]");
    console.error('Example: pnpm query "SELECT id, title FROM digests LIMIT 3"');
    process.exit(2);
  }

  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error(`Error: ${envPath} not found.`);
    process.exit(1);
  }
  config({ path: envPath });
  if (!process.env.POSTGRES_URL) {
    console.error("Error: POSTGRES_URL not set in .env");
    process.exit(1);
  }

  try {
    const result = await sql.query(query);
    if (result.rows.length === 0) {
      console.log("(no rows)");
      console.log(`Affected: ${result.rowCount ?? 0}`);
      return;
    }
    if (pretty) {
      for (const row of result.rows) {
        console.log(JSON.stringify(row, null, 2));
      }
    } else {
      for (const row of result.rows) {
        console.log(JSON.stringify(row));
      }
    }
    console.log(`(${result.rows.length} row${result.rows.length === 1 ? "" : "s"})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Query failed: ${msg}`);
    process.exit(1);
  }
}

main();
