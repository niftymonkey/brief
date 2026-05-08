# Brief CLI

`brief` is a command-line tool that fetches a YouTube video's transcript and prints it to stdout. It exists for unattended use — interactive humans, shell scripts, and AI coding agents that want to "watch" a video by reading its captions.

## Install

The CLI lives in this repo at `apps/cli`. To install it globally:

```bash
pnpm install
pnpm --filter @brief/cli build
cd apps/cli
pnpm link --global
```

Verify:

```bash
which brief        # should print a path under pnpm's global bin
brief --help
```

After source changes, run `pnpm --filter @brief/cli build` from the repo root — the global symlink already points at `apps/cli/dist/main.cjs`, so the rebuild lands automatically.

To remove later: `cd apps/cli && pnpm unlink --global`.

## Usage

```bash
brief <url-or-id> [options]
```

Accepts either a full YouTube URL or a bare 11-character video ID:

```bash
brief https://www.youtube.com/watch?v=dQw4w9WgXcQ
brief https://youtu.be/dQw4w9WgXcQ
brief dQw4w9WgXcQ
```

Output goes to stdout; diagnostics (header, errors) go to stderr. Pipe-friendly by design: `brief <id> > transcript.txt` writes only the transcript, not the header.

## Flags

| Flag | Description |
|---|---|
| `--json` | Emit machine-readable JSON instead of plain text. Stable schema (`schemaVersion 1.0.0`). |
| `--no-metadata` | Skip the YouTube Data API metadata fetch. Header collapses to bare video ID. |
| `--source=auto\|local\|supadata` | Override the source cascade. Default `auto`. |
| `--timeout=<ms>` | Overall request budget. Aborts mid-cascade if exceeded. |
| `--supadata-key=<key>` | Override `SUPADATA_API_KEY` env var. |
| `--youtube-key=<key>` | Override `YOUTUBE_API_KEY` env var. |
| `--help` | Print usage. |

## Sources

The CLI cascades across two upstream transcript providers:

1. **`youtube-transcript-plus`** (the `local` source) — no API key required, scrapes YouTube's caption tracks. Works on residential IPs.
2. **Supadata** (the `supadata` source) — used only if `SUPADATA_API_KEY` is set. `mode: "auto"` falls back to AI-generated transcripts when YouTube has no native captions.

`--source=auto` (the default) tries `local` first and falls through to `supadata` only on transient or unavailable failures. `--source=local` and `--source=supadata` constrain the cascade for debugging.

If `SUPADATA_API_KEY` is unset, the CLI runs zero-config on `local` only.

## Environment variables

| Variable | Required? | Effect |
|---|---|---|
| `SUPADATA_API_KEY` | optional | If set, Supadata is included in the cascade. Get one at [supadata.ai](https://supadata.ai/). |
| `YOUTUBE_API_KEY` | optional | If set, the CLI fetches video metadata (title, channel, duration) and surfaces it in the header. Get one at [console.cloud.google.com](https://console.cloud.google.com/). |

Both are optional. With neither set, the CLI fetches transcripts only and shows a bare video-ID header.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Transcript retrieved successfully. |
| `1` | Argument or unexpected error. |
| `2` | Async generation queued by the upstream provider. The output includes a `jobId` to retry later. |
| `3` | Permanently unavailable (no captions, video removed, video private, invalid ID). |
| `4` | Transient failure after internal retries exhausted. Safe to retry the whole call. |

Scripts and agents can branch on the exit code without parsing output.

## JSON output schema

`--json` produces output following this shape (schemaVersion `1.0.0`):

```jsonc
{
  "schemaVersion": "1.0.0",
  "status": "ok" | "pending" | "unavailable" | "transient",
  "source": "youtube-transcript-plus" | "supadata" | null,
  "video": {
    "id": "dQw4w9WgXcQ",
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "title": "...",        // present iff metadata fetched
    "channel": "...",      // present iff metadata fetched
    "duration": "PT3M33S", // present iff metadata fetched
    "publishedAt": "..."   // present iff metadata fetched
  },
  "transcript": null | {
    "language": "en",
    "text": "...",          // joined plain-text blob (most agents want this)
    "entries": [
      { "offsetSec": 1.36, "durationSec": 1.68, "text": "..." }
    ]
  },
  "job": null | { "id": "...", "retryAfterSeconds": 90 },
  "reason": "no-captions" | "video-removed" | "video-private" | "invalid-id",
  "message": "..."
}
```

`schemaVersion` is in the output so consumers can detect breaking changes. The major version bumps when the shape changes incompatibly.

For the most common "agent reads the transcript" use case, `transcript.text` is the joined plain-text blob — no need to walk `entries[]`.

## Examples

Fetch a transcript:

```bash
brief https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Get JSON for an agent:

```bash
brief dQw4w9WgXcQ --json
```

Skip metadata (faster, no YouTube Data API call):

```bash
brief dQw4w9WgXcQ --no-metadata
```

Force a specific source for debugging:

```bash
brief dQw4w9WgXcQ --source=local
brief dQw4w9WgXcQ --source=supadata
```

Set a tight overall timeout:

```bash
brief dQw4w9WgXcQ --timeout=5000
```

Branch on exit code in a script:

```bash
if brief "$URL" > transcript.txt; then
  echo "got transcript"
elif [ $? -eq 3 ]; then
  echo "video unavailable; skipping"
elif [ $? -eq 4 ]; then
  echo "transient failure; retry later"
fi
```

## Architecture

The CLI is a thin shell around `@brief/core`, the workspace package that owns the cascade, source adapters, retry/backoff, and result modeling. See [`docs/architecture/transcript-cli.md`](architecture/transcript-cli.md) for the design pass.

- `apps/cli` — entrypoint, argument parsing, exit-code mapping, output rendering.
- `packages/core` — `extractVideoId`, `fetchTranscript`, `fetchMetadata`, `formatTranscript`, source adapters, types.
