# Brief

AI-powered summaries from YouTube videos. BYOK (bring your own API keys).

## Features

- **Structured Summaries** - AI-generated topic sections with timestamp ranges and key takeaways
- **Smart Link Categorization** - Extracts URLs from descriptions and sorts them into "Related" (resources, docs, tools) vs "Other" (social, sponsors)
- **Tangent Detection** - Off-topic segments are separated so you know what's there without cluttering the main content
- **Clickable Timestamps** - Jump directly to any section in the video

## Getting Started

### Web application

Full-featured web app with user accounts and saved briefs.

```bash
pnpm dev
```

### `brief` CLI

A standalone command-line tool that fetches a YouTube video's transcript to stdout. Useful for shell scripts and AI coding agents that want to "watch" a video by reading its captions. Different scope from the web app — transcripts only, no AI summary.

```bash
brief <url-or-id>
```

[CLI Documentation](docs/CLI.md)

## Requirements

- Node.js 18+
- Anthropic API key (web app)
- YouTube Data API v3 key (web app; optional for the CLI)
- Videos must have captions enabled

## Development

### Two databases

Brief runs on two Neon branches:

- **`main`** is production. Only the deployed site and commands with `--prod` touch it.
- **`dev`** is a child of `main`, so it starts as a copy of production's data. Local development always uses it (`POSTGRES_URL` in `apps/web/.env`).

You can break `dev` freely. Production stays safe, and you can always reset `dev` from production.

### Changing the schema

1. Write a migration in `apps/web/migrations/`. Use the next free number, and never rename a file after it has run anywhere.
2. Run it on dev with `pnpm --filter @brief/web migrate <file>`, and build against it.

### Shipping a change that has a migration

1. **Before you merge**, run the migration on production: `pnpm --filter @brief/web migrate <file> --prod`. The merged code goes live at once. If its tables or columns do not exist yet, its pages crash.
2. Merge.
3. Check that production has it: `pnpm --filter @brief/web inspect-schema --prod`.
4. Reset dev from production (below).

### Resetting dev from production

```bash
pnpm --filter @brief/web db:sync-from-prod --dry-run   # checks and plan only
pnpm --filter @brief/web db:sync-from-prod             # asks you to type yes
```

This replaces everything in `dev` with production's current data. Run it after every merge whose migration ran on production, and any time dev data gets messy. Then run `migrate <file>` again for any migration on your current branch that production does not have yet.

After the reset, it moves your rows from your production user id to your local one. WorkOS gives you a different id in each environment, so without this step you would see no data locally.

The reset needs `NEON_API_KEY`, `NEON_PROJECT_ID` and `POSTGRES_URL` in `apps/web/.env` (see `apps/web/.env.example`). It refuses to run unless `POSTGRES_URL` points at the `dev` branch, so it cannot reset production. Moving your rows also needs `DEV_OWNER_PROD_USER_ID` and `DEV_OWNER_LOCAL_USER_ID`. If either is missing, the script says so before you confirm, then resets without moving them.

### Repair scripts

`pnpm --filter @brief/web backfill-video-facts` fills in collection entries that are missing a title, runtime or frame shape from YouTube. A lookup can fail when an entry is saved, for example during a YouTube outage or with an exhausted quota. Re-run the script whenever that happens. Add `--dry-run` to see what it would change.

It runs on dev by default. Add `--prod` to run it on production: it then reads the database from `apps/web/.env.production` only and asks you to type `yes` first. Run it there once after a merge that adds a column it fills, so existing entries get the new value.

## License

MIT
