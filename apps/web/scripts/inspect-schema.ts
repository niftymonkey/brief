#!/usr/bin/env tsx
/**
 * Schema inspection — answers "has migration N actually landed in this DB?"
 * by parsing `migrations/*.sql` to derive expected schema (additions and
 * deletions) and comparing against `information_schema`.
 *
 * Read-only. Local by default; pass `--prod` (with confirmation) to inspect
 * production. Per-migration status: applied | partial | not-applied. Also
 * flags columns that exist in the DB but were never declared by any
 * migration — useful for detecting drift or columns added out-of-band.
 *
 * Usage:
 *   pnpm --filter @brief/web inspect-schema             # local
 *   pnpm --filter @brief/web inspect-schema --prod      # production (asks)
 *   pnpm --filter @brief/web inspect-schema --json      # machine-readable
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface ExpectedTable {
  name: string;
  introducedBy: string;
}

interface ExpectedColumn {
  table: string;
  name: string;
  introducedBy: string;
}

interface MigrationExpectations {
  file: string;
  addedTables: ExpectedTable[];
  addedColumns: ExpectedColumn[];
  droppedColumns: ExpectedColumn[];
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    isProd: argv.includes("--prod"),
    isJson: argv.includes("--json"),
  };
}

async function confirmProduction(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  About to inspect PRODUCTION schema (read-only).\nType 'yes' to confirm: ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      },
    );
  });
}

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
const ADD_COLUMN_RE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s/im;
const DROP_COLUMN_RE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/im;

// Inline column lines start with an identifier followed by a type. Anything
// starting with a constraint keyword is skipped so PRIMARY KEY / UNIQUE /
// FOREIGN KEY / CHECK / CONSTRAINT don't get mistaken for columns.
const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "unique",
  "foreign",
  "check",
  "constraint",
  "exclude",
]);

const COLUMN_LINE_RE = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+[a-zA-Z]/;

/**
 * Pulls column names out of the body of a `CREATE TABLE foo (...)` block.
 * Skips constraint definitions; only flags lines that look like
 * `<identifier> <TYPE> ...`.
 */
function parseInlineColumns(body: string): string[] {
  const cols: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const firstWord = line.split(/\s+/)[0]?.toLowerCase();
    if (!firstWord) continue;
    if (CONSTRAINT_KEYWORDS.has(firstWord)) continue;
    const m = line.match(COLUMN_LINE_RE);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

function parseMigration(file: string): MigrationExpectations {
  const text = fs.readFileSync(file, "utf-8");
  const fileName = path.basename(file);
  const addedTables: ExpectedTable[] = [];
  const addedColumns: ExpectedColumn[] = [];
  const droppedColumns: ExpectedColumn[] = [];

  // Strip line comments so they don't fool the regexes.
  const stripped = text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  // CREATE TABLE blocks — capture both the table name and the inline columns.
  CREATE_TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_TABLE_RE.exec(stripped))) {
    const tableName = m[1].toLowerCase();
    addedTables.push({ name: tableName, introducedBy: fileName });
    for (const col of parseInlineColumns(m[2])) {
      addedColumns.push({ table: tableName, name: col, introducedBy: fileName });
    }
  }

  // ALTER TABLE statements — one per `;`-delimited statement.
  for (const stmt of stripped.split(";")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;

    const addMatch = trimmed.match(ADD_COLUMN_RE);
    if (addMatch) {
      addedColumns.push({
        table: addMatch[1].toLowerCase(),
        name: addMatch[2].toLowerCase(),
        introducedBy: fileName,
      });
      continue;
    }

    const dropMatch = trimmed.match(DROP_COLUMN_RE);
    if (dropMatch) {
      droppedColumns.push({
        table: dropMatch[1].toLowerCase(),
        name: dropMatch[2].toLowerCase(),
        introducedBy: fileName,
      });
      continue;
    }
  }

  return { file: fileName, addedTables, addedColumns, droppedColumns };
}

function loadAllMigrations(): MigrationExpectations[] {
  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) {
    console.error(`Error: migrations directory not found at ${dir}`);
    process.exit(1);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => parseMigration(path.join(dir, f)));
}

async function fetchActualSchema(): Promise<{ tables: Set<string>; columnsByTable: Map<string, Set<string>> }> {
  const tables = new Set<string>();
  const columnsByTable = new Map<string, Set<string>>();

  const tablesResult = await sql.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  for (const row of tablesResult.rows as Array<{ table_name: string }>) {
    tables.add(row.table_name.toLowerCase());
  }

  const colsResult = await sql.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  for (const row of colsResult.rows as Array<{ table_name: string; column_name: string }>) {
    const table = row.table_name.toLowerCase();
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table)!.add(row.column_name.toLowerCase());
  }

  return { tables, columnsByTable };
}

type MigrationStatus = "applied" | "partial" | "not-applied";

interface MigrationReport {
  file: string;
  status: MigrationStatus;
  missing: string[];
  /** Columns this migration dropped but that are still present in the DB. */
  stillPresent: string[];
}

function evaluateMigrations(
  migrations: MigrationExpectations[],
  actual: { tables: Set<string>; columnsByTable: Map<string, Set<string>> },
): MigrationReport[] {
  // Build a set of "<table>.<column>" pairs that get dropped by *some* later
  // migration, so a column added in 001 and dropped in 005 doesn't flag 001
  // as partial just because the column isn't in the DB right now.
  const droppedLaterByMigration = new Map<string, Set<string>>();
  for (let i = 0; i < migrations.length; i++) {
    const droppedLater = new Set<string>();
    for (let j = i + 1; j < migrations.length; j++) {
      for (const d of migrations[j].droppedColumns) {
        droppedLater.add(`${d.table}.${d.name}`);
      }
    }
    droppedLaterByMigration.set(migrations[i].file, droppedLater);
  }

  return migrations.map((m) => {
    const missing: string[] = [];
    const stillPresent: string[] = [];
    const droppedLater = droppedLaterByMigration.get(m.file) ?? new Set<string>();

    for (const t of m.addedTables) {
      if (!actual.tables.has(t.name)) missing.push(`table ${t.name}`);
    }
    for (const c of m.addedColumns) {
      const key = `${c.table}.${c.name}`;
      if (droppedLater.has(key)) continue; // satisfied indirectly by a later drop
      const cols = actual.columnsByTable.get(c.table);
      if (!cols || !cols.has(c.name)) missing.push(key);
    }
    for (const c of m.droppedColumns) {
      const cols = actual.columnsByTable.get(c.table);
      if (cols && cols.has(c.name)) stillPresent.push(`${c.table}.${c.name}`);
    }

    let status: MigrationStatus;
    if (missing.length === 0 && stillPresent.length === 0) {
      status = "applied";
    } else {
      // "not-applied" requires that nothing this migration tried to do has
      // taken effect. Otherwise call it partial — clearer signal than a
      // misleading "applied" or "not-applied".
      const addedTablePresent = m.addedTables.some((t) => actual.tables.has(t.name));
      const addedColumnPresent = m.addedColumns.some((c) => {
        if (droppedLater.has(`${c.table}.${c.name}`)) return false;
        return actual.columnsByTable.get(c.table)?.has(c.name) ?? false;
      });
      const dropTookEffect = m.droppedColumns.some((c) => {
        const cols = actual.columnsByTable.get(c.table);
        return !cols || !cols.has(c.name);
      });
      const anyApplied = addedTablePresent || addedColumnPresent || dropTookEffect;
      status = anyApplied ? "partial" : "not-applied";
    }

    return { file: m.file, status, missing, stillPresent };
  });
}

interface UnexpectedColumn {
  table: string;
  column: string;
}

function findUnexpectedColumns(
  migrations: MigrationExpectations[],
  actual: { tables: Set<string>; columnsByTable: Map<string, Set<string>> },
): UnexpectedColumn[] {
  // Build the "should exist" set: every added column minus every dropped column,
  // in order. A column added in 001 and dropped in 005 is correctly not expected.
  const expectedByTable = new Map<string, Set<string>>();
  for (const m of migrations) {
    for (const c of m.addedColumns) {
      if (!expectedByTable.has(c.table)) expectedByTable.set(c.table, new Set());
      expectedByTable.get(c.table)!.add(c.name);
    }
    for (const c of m.droppedColumns) {
      expectedByTable.get(c.table)?.delete(c.name);
    }
  }

  const unexpected: UnexpectedColumn[] = [];
  for (const [table, cols] of actual.columnsByTable) {
    const expected = expectedByTable.get(table) ?? new Set<string>();
    for (const col of cols) {
      if (!expected.has(col)) unexpected.push({ table, column: col });
    }
  }
  return unexpected;
}

function printHuman(reports: MigrationReport[], unexpected: UnexpectedColumn[], environment: string, host: string): void {
  console.log(`\nSchema inspection — ${environment} (${host})\n`);
  for (const r of reports) {
    const tag = r.status === "applied" ? "✓ applied" : r.status === "partial" ? "⚠ partial" : "✗ not-applied";
    console.log(`  ${tag}  ${r.file}`);
    for (const item of r.missing) console.log(`              missing: ${item}`);
    for (const item of r.stillPresent) console.log(`              still present (should be dropped): ${item}`);
  }
  console.log();

  if (unexpected.length > 0) {
    console.log("Unexpected columns (in DB but not declared by any migration):");
    for (const u of unexpected) console.log(`  ${u.table}.${u.column}`);
    console.log();
  }
}

async function main() {
  const { isProd, isJson } = parseArgs();
  const envFile = isProd ? ".env.production" : ".env";
  const envPath = path.join(process.cwd(), envFile);

  if (!fs.existsSync(envPath)) {
    console.error(`Error: environment file not found: ${envFile}`);
    if (isProd) console.error("Create .env.production with your production POSTGRES_URL");
    process.exit(1);
  }
  config({ path: envPath });

  if (!process.env.POSTGRES_URL) {
    console.error(`Error: POSTGRES_URL not found in ${envFile}`);
    process.exit(1);
  }

  if (isProd) {
    const ok = await confirmProduction();
    if (!ok) {
      console.log("\nCancelled.\n");
      process.exit(0);
    }
  }

  const migrations = loadAllMigrations();
  const actual = await fetchActualSchema();
  const reports = evaluateMigrations(migrations, actual);
  const unexpected = findUnexpectedColumns(migrations, actual);

  const url = new URL(process.env.POSTGRES_URL);
  const environment = isProd ? "PRODUCTION" : "local";

  if (isJson) {
    console.log(
      JSON.stringify({ environment, host: url.host, migrations: reports, unexpectedColumns: unexpected }, null, 2),
    );
    process.exit(0);
  }

  printHuman(reports, unexpected, environment, url.host);
  process.exit(0);
}

main().catch((err) => {
  console.error("inspect-schema failed:", err);
  process.exit(1);
});
