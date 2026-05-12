# Brief — project notes for Claude

Repo-specific guidance that complements `~/.claude/CLAUDE.md`. Read both.

## Running ad-hoc SQL against the local DB

Use the `query` script. Local-only by design (reads `POSTGRES_URL` from `apps/web/.env`, no `--prod` flag — prod queries go through the Vercel/Neon dashboard, not from a local shell).

```sh
pnpm --filter @brief/web query "SELECT id, title FROM digests LIMIT 3"
pnpm --filter @brief/web query --pretty "SELECT frames_status, frames_metrics FROM digests ORDER BY created_at DESC LIMIT 1"
```

The script is at `apps/web/scripts/query.ts`. Use `--pretty` to get JSON-formatted output for JSONB columns. Don't write one-off inspection scripts — anything you'd put in such a script is a `pnpm query` invocation.

## Running migrations

```sh
pnpm --filter @brief/web migrate <file>             # local
pnpm --filter @brief/web migrate <file> --prod      # production (asks for confirmation)
pnpm --filter @brief/web migrate <file> --dry-run   # print the SQL without executing
```

Migration files live in `apps/web/migrations/` and run in lexical order — never rename one after it's been applied anywhere.

## Checking which migrations have landed

```sh
pnpm --filter @brief/web inspect-schema             # local
pnpm --filter @brief/web inspect-schema --prod      # production (read-only, asks for confirmation)
pnpm --filter @brief/web inspect-schema --json      # machine-readable
```

Parses every migration in `apps/web/migrations/` to derive the expected schema (additions and drops), then compares against `information_schema`. Per-migration status is `applied` / `partial` / `not-applied`. Also flags columns that exist in the DB but aren't declared by any migration. Use this after applying a migration to prod to confirm it actually landed.

## Local CLI iteration

`pnpm cli:local` runs `apps/cli` against `http://localhost:3000`, sourcing `apps/web/.env.local` first so env-driven settings (OpenRouter key, WorkOS client ID, etc.) match the web server.

```sh
pnpm cli:local generate <url> --with-frames        # full augmented brief end-to-end
pnpm cli:local ask <url> "<question>"              # ask, idempotent on re-runs
pnpm cli:local transcript <url> --with-frames      # local augmented transcript, no server
```

The video-frames pipeline disk-caches per `videoId` under `os.tmpdir()/brief-frames-cache/<videoId>/`. First run on a video is ~1–3 min; subsequent runs against the same video (across `ask` / `generate` / `transcript`) hit the cache and are near-instant.
