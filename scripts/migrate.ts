#!/usr/bin/env tsx
/**
 * Database Migration Script
 *
 * Usage: pnpm migrate [migration-file]
 *
 * Examples:
 *   pnpm migrate                              # Runs 001_create_digests_table.sql
 *   pnpm migrate 002_add_indexes.sql          # Runs specific migration
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as fs from "fs";
import * as path from "path";

// Load environment variables from .env (Vercel uses .env.local, but we use .env)
config({ path: path.join(process.cwd(), ".env") });

async function runMigration() {
  const migrationFile = process.argv[2] || "001_create_digests_table.sql";

  console.log(`Starting database migration: ${migrationFile}\n`);

  if (!process.env.POSTGRES_URL) {
    console.error("Error: POSTGRES_URL not found in .env");
    console.error("Please ensure your .env file has the POSTGRES_URL variable set.\n");
    process.exit(1);
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

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) continue;

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

    console.log("Migration completed successfully!\n");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
