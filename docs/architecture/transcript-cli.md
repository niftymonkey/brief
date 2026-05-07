# Transcript CLI Architecture

Design pass for issue [#76](https://github.com/niftymonkey/brief/issues/76) — a shared transcript-fetching package and a sibling CLI app. Captures locked architectural decisions; the issue + its follow-up comment are the working source of truth, this document is the artifact.

## Why this design

Two surfaces need YouTube transcript retrieval: the existing web app and a new CLI for unattended use (interactive humans, shell scripts, AI coding agents). Today the web app's fetcher dispatches to one of two upstream sources by env-var presence and discards Supadata's async-generation jobs. The new shared package replaces that with a deterministic cascade, models four distinct outcomes as a discriminated union, and treats the reliability concerns documented in [#75](https://github.com/niftymonkey/brief/issues/75) — retry/backoff, schema validation at the upstream boundary, jobId tracking — as foundational v1 behavior rather than future drop-ins.

## Module landscape

### `packages/transcript`

| Module | Role |
|---|---|
| **TranscriptFetcher** | Cascade orchestrator. Concentrates: cascade rules, source-agnostic result modeling, default retry application, jobId-aware terminal branching. The deepest module in the design. |
| **TranscriptSource** | Internal seam. Two production adapters (`youtube-transcript-plus`, `supadata`) plus a stub for tests. Concentrates: provider-specific request/response handling, schema validation, unit normalization. |
| **MetadataFetcher** | Sibling module. YouTube Data API + pinned-comment fetch. Independent failure modes from the transcript fetcher; shares only the video-ID parser. |
| **VideoIdParser** | Pure utility. Accepts URLs and bare 11-character IDs. |
| **TranscriptResult / MetadataResult** | Discriminated unions; the *interface* the package presents to callers. |
| **RetryPolicy / `withRetry`** | Source decorator. Default policy applied in the cascade; callers can override. |

### `apps/cli`

| Module | Role |
|---|---|
| **Renderer** | Pure transformation from `CombinedResult` to `{ stdout, stderr }`. Two formats inside one module (human, JSON), switched by parameter. |
| **ExitCodeMapper** | Pure function over `TranscriptResult.kind`. Separate from the renderer because the exit code is invariant across formats. |
| **Entrypoint** | Glue: parse args (`node:util` `parseArgs`), call fetchers, render, exit. |

### Deleted candidates (recorded so they don't get re-suggested)

- *Argument parser as a module* — wrapping a parsing library is a pass-through. `parseArgs` used directly in the entrypoint.
- *Per-CLI metadata wrapper* — no leverage; the package's `fetchMetadata` is consumed directly.
- *Retry policy as a separately-shipped module* — implemented as a decorator on the source interface, not exported as a module of its own.

## Public interface

```
extractVideoId(input: string): string | null         // URL or bare 11-char ID
fetchTranscript(input: string, opts?: TranscriptOptions): Promise<TranscriptResult>
fetchMetadata(input: string, opts: MetadataOptions): Promise<MetadataResult>

// Future-additive:
// resumeTranscript(jobId: string, opts: TranscriptOptions): Promise<TranscriptResult>
```

### TranscriptResult — discriminated union

```
type TranscriptResult =
  | { kind: "ok",          source, lang?, entries }
  | { kind: "pending",     source, jobId, retryAfterSeconds, message }
  | { kind: "unavailable", reason, message }
  | { kind: "transient",   cause, message }
```

Callers pattern-match `kind`. No string-matching on error messages — that's the failure mode the existing web-app fetcher exhibits and the new package eliminates.

`ok`/`pending` carry `source` for provenance. `unavailable`/`transient` don't — those outcomes may have come from multiple cascade attempts, so attributing them to a single source would be misleading.

### TranscriptOptions

```
{
  supadataApiKey?,        // omit to disable Supadata in the cascade
  signal?,                // standard cancellation
  sources?,               // override cascade order; default: ["youtube-transcript-plus", "supadata"]
  retryPolicy?            // overrides the package default
}
```

## Internal seam — TranscriptSource

```
interface TranscriptSource {
  readonly name
  fetch(videoId, signal?): Promise<SourceOutcome>
}

type SourceOutcome =
  | { kind: "ok",          lang?, entries }
  | { kind: "pending",     jobId, retryAfterSeconds }   // only Supadata
  | { kind: "unavailable", reason }
  | { kind: "transient",   cause }
```

Capability flags on the interface would over-engineer for a non-problem. `youtube-transcript-plus` simply never returns `pending`; the interface admits it uniformly across providers.

`withRetry(source, policy): TranscriptSource` decorates a source with retry semantics. The cascade orchestrator consumes already-decorated sources, so retry is transparent at the cascade level.

### Cascade rules

Walk sources in order. Track the most-informative outcome seen.

| Outcome | Behavior |
|---|---|
| `ok` | Return immediately. |
| `pending` | Return immediately (we've committed to async generation). |
| `unavailable` | Try next source. Different sources can disagree — Supadata's `mode: "auto"` synthesizes captions when youtube-transcript-plus reports none. |
| `transient` | Try next source. If a later source returns `unavailable`, prefer that (more informative). Otherwise return `transient`. |

This is the part of the orchestrator that earns its keep — duplicating it in two consumers is exactly what the package exists to prevent.

## CLI surface

| Element | Decision |
|---|---|
| Binary name | `brief-transcript` |
| Positional | `<url-or-id>` |
| `--json` | Switch to machine-readable output |
| `--no-metadata` | Skip YouTube Data API call |
| `--source=auto\|local\|supadata` | Override cascade for debugging |
| `--timeout=<ms>` | Overall request budget |
| `--supadata-key=<key>` / `--youtube-key=<key>` | Env-var overrides |
| Arg parser | `node:util` `parseArgs` (zero deps) |
| Output discipline | Data on stdout, diagnostics on stderr, no ANSI on stdout, ANSI only on stderr-TTY |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Transcript retrieved |
| `2` | Async generation queued (jobId in output) |
| `3` | Permanently unavailable |
| `4` | Transient failure after internal retries exhausted |
| `1` | Argument or unexpected error |

### Defaults

- **No `SUPADATA_API_KEY`:** silently skip Supadata; CLI is fully functional with zero config.
- **No `YOUTUBE_API_KEY`:** silently skip metadata; header shows just the video ID. Metadata failures never affect exit code.

## JSON output schema

```jsonc
{
  "schemaVersion": "1.0.0",
  "status": "ok" | "pending" | "unavailable" | "transient",
  "source": "youtube-transcript-plus" | "supadata" | null,
  "video": { "id", "url", "title?", "channel?", "duration?", "publishedAt?" },
  "transcript": null | { "language", "entries": [{ "offsetSec", "durationSec", "text" }] },
  "job": null | { "id", "retryAfterSeconds" },
  "reason": "no-captions" | "video-removed" | "video-private" | "invalid-id",  // when unavailable
  "message": "Human-readable summary"
}
```

`schemaVersion` is in the output explicitly so callers can detect breaking changes. Bump major when the shape changes; the package's npm version follows.

## Dependency classification

| Module | Dependencies | Category | Seam |
|---|---|---|---|
| TranscriptFetcher | TranscriptSources | n/a | Internal seam — three adapters justify a real port |
| TranscriptSource adapters | youtube-transcript-plus, @supadata/js | True external | Internal port; production + stub |
| MetadataFetcher | @googleapis/youtube | True external | Internal only — single provider, no port at the package's external interface |
| VideoIdParser | none | Pure | None |
| Renderer | TranscriptResult type | Pure | None |
| ExitCodeMapper | TranscriptResult type | Pure | None |
| Entrypoint | TranscriptFetcher, MetadataFetcher, Renderer, ExitCodeMapper | Mixed | Tested via the boundaries below it |

The package's *external* interface has no port. The TranscriptSource port is purely internal — consumers of `packages/transcript` don't see Supadata or youtube-transcript-plus at all.

## Test surface

- **`packages/transcript`**: tests cross `fetchTranscript()` with stub TranscriptSources. The cascade rules table is the test matrix. Adapter tests use recorded fixtures or HTTP mocks at the network layer. The Supadata schema validator has its own tests against representative response shapes.
- **`apps/cli`**: Renderer and ExitCodeMapper tested directly with synthesized `CombinedResult` values. Entrypoint tested via integration (spawn the binary, assert on stdout/stderr/exit code). No mocking through the package boundary.

## Locked decisions

| # | Decision |
|---|---|
| 1 | CLI bin name: `brief-transcript` |
| 2 | No Supadata key → silent skip; CLI runs zero-config on local-only |
| 3 | Metadata: best-effort with key, skip without; never affects exit code |
| 4 | Arg parser: `node:util` `parseArgs` (no dep) |
| 5 | `--source=auto\|local\|supadata` flag ships in v1 |
| 6 | `extractVideoId` and `fetchMetadata` move into `packages/transcript` as part of #76; web app re-imports immediately |
| 7 | `extractVideoId` accepts bare 11-character IDs in addition to URLs |

## Relationship to other tickets

- **#76** — this design pass; deliverable is the package + CLI.
- **#75** — narrowed to "the web app's existing local fetcher." Closes by inheritance when the web-app migration ticket lands.
- **Web-app migration ticket** — drafted as a follow-up to #76. Swaps `apps/web` to consume `packages/transcript`, retires `apps/web/src/lib/transcript.ts`, closes #75.
