#!/usr/bin/env tsx
/**
 * Database Migration Script
 *
 * Usage: pnpm migrate [migration-file] [--prod] [--dry-run]
 *
 * Examples:
 *   pnpm migrate                              # Runs 001_create_digests_table.sql on local
 *   pnpm migrate 002_add_indexes.sql          # Runs specific migration on local
 *   pnpm migrate 002_add_indexes.sql --prod   # Runs migration on PRODUCTION (requires confirmation)
 *   pnpm migrate 002_add_indexes.sql --dry-run  # Shows what would be executed without running
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

function parseArgs() {
  const args = process.argv.slice(2);
  const isProd = args.includes("--prod");
  const isDryRun = args.includes("--dry-run");
  const migrationFile = args.find((arg) => !arg.startsWith("--")) || "001_create_digests_table.sql";
  return { isProd, isDryRun, migrationFile };
}

async function confirmProduction(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  WARNING: You are about to run migrations on PRODUCTION!\n" +
        "Type 'yes' to confirm: ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      }
    );
  });
}

async function runMigration() {
  const { isProd, isDryRun, migrationFile } = parseArgs();
  const envFile = isProd ? ".env.production" : ".env";
  const envPath = path.join(process.cwd(), envFile);

  // Check if env file exists
  if (!fs.existsSync(envPath)) {
    console.error(`Error: Environment file not found: ${envFile}`);
    if (isProd) {
      console.error("Create .env.production with your production POSTGRES_URL");
    }
    process.exit(1);
  }

  // Load environment variables
  config({ path: envPath });

  const environment = isProd ? "PRODUCTION" : "local";
  console.log(`\n🗄️  Database Migration`);
  console.log(`   Environment: ${environment}`);
  console.log(`   Migration:   ${migrationFile}`);
  if (isDryRun) {
    console.log(`   Mode:        DRY RUN (no changes will be made)`);
  }
  console.log();

  // Require confirmation for production (skip in dry-run mode)
  if (isProd && !isDryRun) {
    const confirmed = await confirmProduction();
    if (!confirmed) {
      console.log("\nMigration cancelled.\n");
      process.exit(0);
    }
    console.log();
  }

  if (!process.env.POSTGRES_URL) {
    console.error(`Error: POSTGRES_URL not found in ${envFile}`);
    console.error(`Please ensure your ${envFile} file has the POSTGRES_URL variable set.\n`);
    process.exit(1);
  }

  // Show database host in dry-run mode
  if (isDryRun) {
    const url = new URL(process.env.POSTGRES_URL);
    console.log(`   Database:    ${url.host}\n`);
  }

  try {
    const migrationPath = path.join(process.cwd(), "migrations", migrationFile);

    if (!fs.existsSync(migrationPath)) {
      console.error(`Error: Migration file not found: ${migrationPath}`);
      console.error("\nAvailable migrations:");
      const migrations = fs.readdirSync(path.join(process.cwd(), "migrations"));
      migrations.filter(f => f.endsWith(".sql")).forEach(f => console.log(`  - ${f}`));
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

    // Split by semicolons and filter out comments and empty statements
    const statements = migrationSQL
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => {
        const withoutComments = stmt
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();
        return withoutComments.length > 0;
      });

    console.log(`Found ${statements.length} SQL statement${statements.length === 1 ? "" : "s"}${isDryRun ? " to preview" : " to execute"}\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;

      if (isDryRun) {
        console.log(`[${i + 1}/${statements.length}] Would execute:`);
        console.log("─".repeat(60));
        console.log(statement.trim());
        console.log("─".repeat(60) + "\n");
      } else {
        const firstLine = statement.split("\n")[0].substring(0, 60);
        console.log(`[${i + 1}/${statements.length}] Executing: ${firstLine}...`);

        try {
          await sql.query(statement + ";");
          console.log(`  Done\n`);
        } catch (error: any) {
          if (error.message?.includes("already exists")) {
            console.log(`  Already exists (skipping)\n`);
          } else {
            throw error;
          }
        }
      }
    }

    if (isDryRun) {
      console.log("Dry run complete. No changes were made.\n");
    } else {
      console.log("Migration completed successfully!\n");
    }
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
