# CLI Thin-Client Architecture

Design pass for issue [#88](https://github.com/niftymonkey/brief/issues/88) — migrate brief's CLI from a standalone local pipeline (today: hits Supadata + Anthropic directly, prints transcript JSON) to a thin client of the hosted web service. The CLI authenticates against brief, runs work that needs residential-IP egress on the user's machine, and POSTs results back to the hosted API for persistence and brief generation. Captures locked architectural decisions; the issue + its follow-up comment are the working source of truth, this document is the artifact.

## Why this design

Two forces shape the CLI in 2026:

1. **The egress constraint from [#84](https://github.com/niftymonkey/brief/issues/84).** Server-side yt-dlp from Vercel is reliably blocked by YouTube's anti-bot enforcement, and no ethical vendor sells MP4-bytes-for-YouTube the way Supadata sells transcripts. The only place the video-frames pipeline can run is the user's machine — which is where the CLI already is. The CLI becomes the host for any future feature whose inputs can't be acquired server-side.
2. **The cost-and-quota story.** Brief is moving toward a unified billing surface where every brief's tokens, latency, and storage are accounted to a user account. A standalone CLI that hits Anthropic directly with the user's own key writes outside that surface. The thin-client migration lets the server own the brief-generation half and the metrics row, even when the CLI did residential-IP work locally.

What the migration replaces:

- **CLI today** prints a transcript JSON for the given URL and exits. It is not authenticated, not user-attributed, and writes nothing to brief's database.
- **CLI tomorrow** is a verb-first thin client that exposes a subcommand surface (`login`, `logout`, `whoami`, `transcript`, `generate`). Local-only operations stay local; server-touching operations authenticate against the hosted service. The `generate` subcommand persists a brief to the user's account in brief's database, attributable in the same `digests` table the web app writes to, and returns the brief's public URL.

What the migration does *not* attempt:

- A full feature-parity surface with the web UI. CLI subcommands ship per use case as they're needed (v1: the five above; natural future additions like `list`, `get`, `open`, `delete`, `regenerate` follow the `gh`/`gcloud` pattern as they're asked for).
- Reaching brief generation from the CLI without the hosted service. The CLI is a client, not a peer; `generate` always goes through the hosted API.
- Holding LLM keys server-side in v1. The CLI uses the user's own OpenRouter key for local vision work; a follow-up issue moves that to server-issued ephemeral tokens once the auth shape is proven.

## Industry-standard choices (locked)

Three architectural decisions are picked from established 2026 industry standards rather than invented:

| Concern | Pick | Why |
|---|---|---|
| **Authentication** | WorkOS CLI Auth — OAuth 2.0 Device Authorization Grant (RFC 8628) | WorkOS shipped this as a first-class feature 2025-06-27 specifically for this scenario. It is what `gh`, `gcloud`, `vercel`, and `aws` (post-2.22) all use. Documented endpoints: `POST /user_management/authorize/device` and `POST /user_management/authenticate` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. |
| **Transport** | Shared Zod schemas in `@brief/core` + plain `fetch` | Zero new dependencies. Server validates with `Submission.parse(...)`; CLI imports the same schema and gets request types via `z.infer<typeof Submission>`. tRPC and Hono RPC are overkill given the only non-browser consumer is our own CLI in our own monorepo. |
| **Schema versioning** | `schemaVersion` literal field on the submission; handler branches and normalizes to the latest internal shape | Dominant 2026 pattern for app-scale APIs. URL path stays `/api/brief/intake` until a true breaking change forces `/v2/`. Only additive changes within a major. |

These three picks are the load-bearing constraints below them; the module landscape and the public interface follow from them.

## Module landscape

### `apps/cli`

| Module | Role |
|---|---|
| **AuthFlow** | Concentrates the device-flow dance: requests a device code from WorkOS, displays the user-code + verification URI, polls `/user_management/authenticate` until success or expiry, persists the resulting access + refresh tokens. Surfaces `login()`, `logout()`, `currentSession()`. Backs the `login`/`logout`/`whoami` subcommands. |
| **CredentialStore** | Local persistence for `{ accessToken, refreshToken, expiresAt, userId }`. Wraps `keytar` / `@napi-rs/keyring` for OS-keychain storage where available; falls back to `~/.config/brief/credentials.json` with `0600` perms on platforms without keychain access. Concentrates: cross-platform secret storage, atomic writes, refresh-on-stale. |
| **HostedClient** | Cascade orchestrator for talking to brief's hosted service. Concentrates: base-URL resolution (env var or built-in default), `Authorization: Bearer <token>` injection, token-refresh-on-401, Zod-validated response parsing, retry on transient. Two production adapters (real `fetch`, in-memory stub for tests). Backs `whoami` (lightweight identity check) and `generate` (submission to intake). |
| **Renderer** (existing) | Extended to cover four output shapes: bare transcript (existing), augmented transcript (transcript + visual markers from local frames pipeline), brief URL (one-line stdout for `generate`), brief JSON (structured response for `generate --json`). Format selection by subcommand + `--json` flag. |
| **ExitCodeMapper** (existing) | Extended with two new codes: `5` (authentication required) and `6` (CLI/server schema mismatch — upgrade required). Existing codes (0/2/3/4/1) retain their meaning for the `transcript` subcommand. |
| **Entrypoint** (existing) | Glue + subcommand dispatcher. Reads `argv[2]` as the subcommand name; routes to a per-subcommand handler. Bare-positional invocation (`brief <url>` with no subcommand verb) falls through to `transcript` for backward-compat with the existing CLI, emitting a one-line stderr tip suggesting the explicit form. |

### `apps/web`

| Module | Role |
|---|---|
| **BriefIntake** route handler (`POST /api/brief/intake`) | Receives a `TranscriptSubmission`, validates with Zod, normalizes by `schemaVersion`, persists the transcript + metrics into the existing `digests` table, runs `generateBrief()` synchronously, returns the brief. Reuses the same persistence helpers (`saveBrief`, `copyBriefForUser`) the existing brief route uses. |
| **TokenAuth middleware** | Verifies `Authorization: Bearer <token>` against WorkOS sessions on every CLI-facing route. Returns 401 with a `WWW-Authenticate` header naming the device-flow URL when invalid. Parallels the existing `withAuth` wrapper but for token-bearer rather than cookie-session callers. |
| **CLI token endpoint** (`POST /api/cli/token/refresh`) | Standard OAuth refresh-token exchange. Accepts a refresh token, returns a new access token. The CLI hits this transparently when its access token expires. |

### `packages/core`

| Module | Role |
|---|---|
| **`TranscriptSubmission`** | Discriminated-union Zod schema covering transcript-only and augmented submissions. The public contract between CLI and server. Lives in `@brief/core/submission`. |
| **`TranscriptEntry` (sum-type migration)** | Existing `TranscriptEntry` becomes a discriminated union: `{ kind: "speech", … }` or `{ kind: "visual", … }`. Drives `SCHEMA_VERSION` bump to `"2.0.0"`. |
| **`SCHEMA_VERSION`** | Bumps from `"1.0.0"` to `"2.0.0"`. The constant lives in `@brief/core`; CLI emits it, server reads it. |

### Deleted candidates (recorded so they don't get re-suggested)

- *Generic HTTP-transport wrapper* (a `RestClient` class wrapping `fetch`) — pass-through. The HostedClient methods build paths and Zod-parse responses; a generic wrapper underneath is one indirection too many. Inline `fetch` calls in HostedClient.
- *Schema-version gatekeeper as a separate module* — a single `if (body.schemaVersion === "2.0.0")` branch inside BriefIntake. Not a module.
- *Frame-or-transcript chooser as a module* — one boolean check (`opts.withFrames`) in the Entrypoint. Not a module.
- *LLM-key loader as a module* — one env-var read where the frames pipeline gets invoked. Not a module.
- *Per-CLI Supadata client* — `@brief/core`'s existing `fetchTranscript()` cascade already does this. CLI consumes it directly.

## Subcommand surface (v1)

The five subcommands split cleanly along whether they touch the hosted service:

| Subcommand | Auth | Hits hosted service? | Touches YouTube? | Output |
|---|---|---|---|---|
| `brief login` | n/a (acquires) | WorkOS device endpoints + `GET /api/cli/whoami` post-success | No | Status line + user email on success |
| `brief logout` | requires (or no-op) | Best-effort `POST /api/cli/logout` to revoke server-side; always clears local | No | Status line |
| `brief whoami` | required | `GET /api/cli/whoami` | No | User email (or `--json` for full identity record) |
| `brief transcript <url-or-id> [--with-frames] [--json]` | not required | No — fully local | Yes (transcript + optionally video bytes) | Transcript text (or augmented transcript if `--with-frames`); `--json` for structured form |
| `brief generate <url-or-id> [--with-frames] [--json]` | required | `POST /api/brief/intake` | Yes (transcript + optionally video bytes) | Brief URL on stdout; `--json` for full structured response |

**Bare-positional shortcut.** `brief <url-or-id>` with no subcommand verb routes to `transcript` for backward-compat with the existing CLI. A one-line stderr tip suggests the explicit form. This shortcut is documented as backward-compat, not as a load-bearing surface — future deprecation is on the table once existing users have migrated.

**Why this split:** `transcript` is a pure local capability — it has been since v1 and the migration shouldn't take that away. It's also the entry point for local iteration on the frames pipeline without burning a brief generation (e.g., debugging which frames the classifier picks). `generate` is the new thin-client-shaped command — it submits work to brief and ties output to a user account. Splitting them means the local capability stays usable when offline, when not signed in, and when the user just wants the transcript.

**Natural future subcommands** (not in v1, listed so the dispatcher shape accommodates them): `brief list` (recent briefs for the signed-in user), `brief get <id>` (fetch one brief), `brief open <id>` (open the brief's URL in a browser), `brief delete <id>`, `brief regenerate <id>` (re-run brief generation on an existing transcript without re-fetching). All follow the `gh pr <verb>` pattern.

## Public interface

### Submission shape (`@brief/core/submission`)

```typescript
import { z } from "zod";

export const SCHEMA_VERSION = "2.0.0" as const;

export const TranscriptEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("speech"),
    offsetSec: z.number(),
    durationSec: z.number(),
    text: z.string(),
    lang: z.string().optional(),
  }),
  z.object({
    kind: z.literal("visual"),
    offsetSec: z.number(),
    mode: z.enum(["verbatim", "summary"]),
    text: z.string(),
  }),
]);

export const VideoMetadataSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelTitle: z.string(),
  channelId: z.string(),
  duration: z.string(),       // ISO-8601
  publishedAt: z.string(),    // ISO-8601
  description: z.string(),
  pinnedComment: z.string().optional(),
});

export const FramesMetricsSchema = z.object({
  videoDurationSec: z.number(),
  candidatesGenerated: z.number(),
  candidatesAfterDedup: z.number(),
  classifierYes: z.number(),
  classifierNo: z.number(),
  visionCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  classifierModel: z.string(),
  visionModel: z.string(),
  wallClockMs: z.number(),
});

export const TranscriptSubmissionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  videoId: z.string(),
  metadata: VideoMetadataSchema,
  transcript: z.array(TranscriptEntrySchema),
  frames: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("not-requested") }),
    z.object({ kind: z.literal("included"), metrics: FramesMetricsSchema }),
    z.object({
      kind: z.literal("attempted-failed"),
      reason: z.string(),
      phase: z.string(),
      metrics: FramesMetricsSchema,
    }),
  ]),
});

export type TranscriptSubmission = z.infer<typeof TranscriptSubmissionSchema>;
```

### HostedClient interface (`apps/cli`)

```typescript
interface HostedClient {
  submit(submission: TranscriptSubmission): Promise<BriefResult>;
  whoami(): Promise<IdentityResult>;
  logout(): Promise<LogoutResult>;       // best-effort server-side revoke
}

type BriefResult =
  | { kind: "ok"; briefId: string; briefUrl: string; brief: BriefBody; metadata: VideoMetadata }
  | { kind: "auth-required"; reason: "expired" | "revoked" | "missing" }
  | { kind: "schema-mismatch"; serverAccepts: string[]; sent: string }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "transient"; cause: string; message: string };

type IdentityResult =
  | { kind: "ok"; email: string; userId: string }
  | { kind: "auth-required"; reason: "expired" | "revoked" | "missing" }
  | { kind: "transient"; cause: string; message: string };

type LogoutResult =
  | { kind: "ok" }
  | { kind: "transient"; cause: string };   // local credentials always cleared regardless
```

Naming follows the existing `@brief/core` convention: result types are named for what they represent (`TranscriptResult`, `MetadataResult`), not for the verb that produced them. `BriefResult` is the brief-or-failure outcome of a `generate`; `IdentityResult` is the identity-or-failure outcome of a `whoami`; `LogoutResult` is a one-off with no natural noun and is named after the operation it terminates.

Callers pattern-match on `kind`. The `auth-required` branch triggers a `login` prompt; `schema-mismatch` triggers a "please upgrade brief" message; `transient` is retried per the existing retry-policy module from `@brief/core`.

`briefUrl` on `BriefResult` is the canonical surface for `generate`'s default human output — one line on stdout, the URL the user can paste into a browser or share. The full `brief` body is included in the same response so `--json` consumers don't need a second round-trip.

### BriefIntake contract (`apps/web`)

```
POST /api/brief/intake
Authorization: Bearer <access-token>
Content-Type: application/json

Body: TranscriptSubmission (Zod-validated)

200 OK
{
  "schemaVersion": "2.0.0",
  "briefId": "...",
  "brief": { "summary": "...", "sections": [...], "relatedLinks": [...], "otherLinks": [...] },
  "metadata": { ... }
}

400 Bad Request — body fails Zod parse (response includes Zod error path)
401 Unauthorized — token missing/expired/revoked (WWW-Authenticate names device-flow URL)
409 Conflict — schemaVersion is one the server no longer accepts; response carries `serverAccepts: string[]`
429 Too Many Requests — daily-quota hit (Retry-After header set)
503 Service Unavailable — downstream LLM transient failure
```

The intake handler is synchronous in v1: it persists the row, runs `generateBrief()`, returns the brief in the same response. Wall-clock budget is bounded by brief generation alone (transcript already in hand from the CLI) — typically 5–15 s. If wall-clock pressure surfaces from real CLI use, revisit with the same async-job-runner trade-off the existing brief route would face — not earlier.

## The auth seam

This is the one real trade-off at design time. WorkOS supports two flows that fit our shape: **Authorization Code + PKCE on a loopback**, and **OAuth 2.0 Device Authorization Grant**. Other CLIs in 2026 ship both, defaulting to one.

| Lens | PKCE loopback | Device flow |
|---|---|---|
| **UX (workstation)** | Best. CLI opens the user's browser; they're already logged into brief; one click and done. | Two-step. CLI prints a URL and a code; user opens browser, pastes code, confirms. |
| **UX (headless: SSH, container, CI)** | Broken. Requires a browser on the same machine as the CLI. | Works. Code is portable; user authenticates anywhere. |
| **Implementation surface** | CLI must run an HTTP server on a free port, handle the redirect, exchange code+PKCE-verifier. ~200 lines of careful code. | CLI just polls an endpoint. ~50 lines. |
| **WorkOS SDK fit** | `@workos-inc/node` v8 has first-class PKCE helpers (`getAuthorizationUrlWithPKCE`, `authenticateWithCode`). | Endpoints are raw HTTP per WorkOS's own Node tutorial; no dedicated SDK method as of late 2025. |
| **Token revocation story** | Same. Both flows produce standard access/refresh tokens revocable via WorkOS dashboard. | Same. |

**Recommendation: device flow as the default in v1, with PKCE loopback as a v2 enhancement.** Three reasons:

1. **Simpler implementation surface** — ~50 lines of polling vs ~200 of redirect-server plumbing. The flow ships sooner.
2. **Headless-friendly by default** — many brief CLI use cases (AI coding agents, scripts, SSH sessions) won't have a usable local browser. PKCE-only would leave them broken.
3. **WorkOS's launch posture leans this direction** — CLI Auth (device flow) is the named, documented feature; PKCE for public clients exists but isn't packaged as "CLI Auth."

The v2 enhancement is straightforward: add PKCE loopback under `brief login`, demote device flow to `brief login --device`, follow the gh/gcloud/aws default-PKCE-fallback-device pattern. v1 ships device-only.

## Failure-mode propagation

The CLI's failure surface is structured around what a user sees and what the exit code carries. The entrypoint dispatches on subcommand:

```typescript
// Pseudocode of the entrypoint after parseArgs.

switch (subcommand) {
  case "login":      return runLogin(opts);
  case "logout":     return runLogout(opts);
  case "whoami":     return runWhoami(opts);
  case "transcript": return runTranscript(positional, opts);
  case "generate":   return runGenerate(positional, opts);
  // Bare-positional shortcut: `brief <url>` → transcript.
  default:           return runTranscript(positional, { ...opts, _bareShortcut: true });
}
```

**`runTranscript` (local-only, no auth):**

```typescript
const transcript = await fetchTranscript(input, { ... });
if (transcript.kind === "unavailable") return printAndExit(transcript, EXIT_UNAVAILABLE /* 3 */);
if (transcript.kind === "transient")   return printAndExit(transcript, EXIT_TRANSIENT   /* 4 */);

if (opts.withFrames) {
  const frames = await extractFrames({ videoId, transcript: transcript.entries, ... });   // #87
  // Frames failure downgrades to bare-transcript output; CLI still exits 0 unless transcript itself failed.
  return renderTranscript({ transcript, frames }, opts.json ? "json" : "human");
}

return renderTranscript({ transcript }, opts.json ? "json" : "human");
```

**`runGenerate` (auth required, server-touching):**

```typescript
const tokens = await credentialStore.read();
if (!tokens) {
  process.stderr.write("Not signed in. Run `brief login` first.\n");
  return EXIT_AUTH_REQUIRED;   // 5
}

const transcript = await fetchTranscript(input, { ... });
if (transcript.kind === "unavailable") return printAndExit(transcript, EXIT_UNAVAILABLE /* 3 */);
if (transcript.kind === "transient")   return printAndExit(transcript, EXIT_TRANSIENT   /* 4 */);

const frames = opts.withFrames
  ? await extractFrames({ videoId, transcript: transcript.entries, ... })
  : { kind: "not-requested" as const };

const submission = buildSubmission(transcript, metadata, frames);
const result = await hostedClient.submit(submission);

switch (result.kind) {
  case "ok":
    process.stdout.write(opts.json ? JSON.stringify(result) : `${result.briefUrl}\n`);
    return EXIT_OK;            // 0
  case "auth-required":
    process.stderr.write("Authentication expired. Run `brief login`.\n");
    return EXIT_AUTH_REQUIRED; // 5
  case "schema-mismatch":
    process.stderr.write("This brief CLI is out of date. Please upgrade.\n");
    return EXIT_SCHEMA_MISMATCH; // 6
  case "rate-limited":
    process.stderr.write(`Daily quota reached. Try again in ${result.retryAfterSeconds}s.\n`);
    return EXIT_TRANSIENT;     // 4
  case "transient":
    process.stderr.write(`Service temporarily unavailable: ${result.message}\n`);
    return EXIT_TRANSIENT;     // 4
}
```

A frames-pipeline failure inside `extractFrames()` does *not* fail either subcommand. In `transcript --with-frames`, the user gets a bare transcript with a stderr note. In `generate --with-frames`, the submission carries `frames.kind = "attempted-failed"` and the server produces a transcript-only brief. This matches the failure-mode contract already designed for `extractFrames()` in the existing (to-be-rewritten) `docs/architecture/video-frames.md`.

## Dependency categories and test surface

| Module | Dependencies | Category | Test strategy |
|---|---|---|---|
| `AuthFlow` | WorkOS user-management endpoints | 4 — True external | Stub HTTP responses for device-code, polling, success, expiry. Test the state machine, not the network. |
| `CredentialStore` | OS keychain (`keytar` / `@napi-rs/keyring`), filesystem | 2 — Local-substitutable | Inject the store backend. In tests, use an in-memory implementation of the same interface. |
| `HostedClient` | brief's hosted API | 3 — Remote but owned | Define a `Transport` port (`fetch`-shaped) at the seam. Production injects real `fetch`; tests inject a stub returning canned responses. Cascade-rule table tests at HostedClient's external interface. |
| `Renderer` | `BriefResult` type | 1 — Pure | Direct unit tests. Synthesized result values; assert on stdout/stderr strings. |
| `ExitCodeMapper` | `BriefResult` type | 1 — Pure | Direct unit tests. Matrix over `result.kind`. |
| `Entrypoint` | All of the above | Mixed | Integration test: spawn the binary against a stubbed hosted service, assert on stdout/stderr/exit code. No mocking through the public interface. |
| `BriefIntake` route | Postgres, `generateBrief()` | 2 — Local-substitutable | Existing brief-route test pattern: real Postgres in a transaction that rolls back, real Zod validation, stubbed LLM at the `generateBrief` seam. |
| `TokenAuth` middleware | WorkOS session API | 4 — True external | Stub WorkOS's session-check call; assert on 401 shape and `WWW-Authenticate` header. |
| `TranscriptSubmission` schema | Zod | 1 — Pure | Direct unit tests. Round-trip representative payloads through `parse()`; assert on rejection messages for breaking schema violations. |

The Zod schema in `@brief/core` is the **shared test surface**: the same `TranscriptSubmissionSchema.parse(...)` runs in CLI tests (validating outbound payloads) and server tests (validating inbound payloads). Schema-drift between CLI and server is impossible by construction — both import the same module.

## Backwards compatibility — `SCHEMA_VERSION` bump

The existing CLI emits `SCHEMA_VERSION = "1.0.0"` for transcript-only JSON output. The new shape bumps to `"2.0.0"` because `TranscriptEntry` becomes a discriminated union and the top-level shape grows a `frames` field.

| Surface | v1 behavior | v2 behavior |
|---|---|---|
| CLI JSON output | Flat entries: `{ offsetSec, durationSec, text }` | Sum-type entries: `{ kind: "speech", offsetSec, durationSec, text }` |
| `--json` consumer contract | `entries[i].text` accessible directly | Consumer must check `entries[i].kind === "speech"` before reading `text`; visual entries carry different fields |
| Server intake | (does not exist in v1) | Accepts only `schemaVersion: "2.0.0"` initially. On `1.0.0`, return `409` with `serverAccepts: ["2.0.0"]` and a message telling the user to upgrade. |

The CLI does not need to retain v1 output mode. There is no external programmatic consumer of the v1 CLI JSON today; the schema-version field exists precisely so this bump can happen cleanly. Web-app consumers of the existing transcript JSONB column in the database are unaffected — the column already stores a richer shape than the v1 CLI emitted.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Auth: WorkOS CLI Auth via device flow (RFC 8628). PKCE loopback deferred to v2 enhancement. |
| 2 | Transport: shared Zod schemas in `@brief/core` + plain `fetch`. No tRPC, no Hono RPC, no OpenAPI codegen. |
| 3 | Schema versioning: `schemaVersion` literal discriminator + handler-side normalize. URL stable until major break. |
| 4 | Credential store: OS keychain via `keytar` / `@napi-rs/keyring`; FS fallback at `~/.config/brief/credentials.json` (`0600`). |
| 5 | LLM key for vision lives on user's machine in v1. Follow-up issue tracks server-issued ephemeral tokens. |
| 6 | Single intake endpoint: `POST /api/brief/intake` accepts both transcript-only and augmented submissions via a discriminated `frames` field. |
| 7 | Synchronous response from intake: server runs `generateBrief()` and returns the brief in the same response. No SSE for CLI in v1. |
| 8 | `TranscriptEntry` becomes a discriminated union (`speech` \| `visual`). `SCHEMA_VERSION` bumps `1.0.0` → `2.0.0`. |
| 9 | Transcript fetch happens CLI-side using `@brief/core`'s existing cascade. Server does not fetch transcripts on behalf of the CLI. |
| 10 | CLI subcommand surface (v1): `brief login`, `brief logout`, `brief whoami`, `brief transcript <url-or-id> [--with-frames]`, `brief generate <url-or-id> [--with-frames]`. `brief <url-or-id>` (no verb) is a backward-compat shortcut for `transcript`. Natural future subcommands (`list`/`get`/`open`/`delete`/`regenerate`) are out of scope for v1 but the dispatcher accommodates them. |
| 11 | `transcript` is local-only (no auth, no server contact). `generate` requires auth and submits to `POST /api/brief/intake`. `whoami`/`login`/`logout` are the auth subcommands. This split keeps the existing local-iteration workflow intact (you can debug the frames pipeline without burning a brief generation) and matches the gh/gcloud verb-first pattern. |
| 12 | `generate` default human output is the brief URL on stdout (one line); `--json` returns the full structured response including the brief body. |

## Open questions for implementation

These resolve during implementation, not at design time:

- **Token refresh trigger.** Refresh on every command (cheap, always-fresh) or refresh only on 401 (lazier, fewer requests). Lazy is cheaper but adds one round-trip on the unlucky boundary case. Decide during build.
- **`brief login` reauth UX.** After successful login, do we print a one-line confirmation or echo the user email? Match `gh auth status` style — terse, one line.
- **Where the `extractFrames()` invocation sits in the entrypoint.** Could live inline in the Entrypoint or be wrapped in a small `runFramesIfRequested()` helper. Trivial — decide at write time. The frames module's own design is #87's deliverable.
- **Quota check ordering.** Server returns 429 if the user is over their daily augmented-brief cap. Should the CLI also check quota locally before doing 5 minutes of frame work? Probably not — the server is the source of truth, and a CLI-side cache would drift. Accept the cost of finding out after the fact in v1; revisit if it becomes a real complaint.
- **`brief whoami` content.** Email + plan tier + remaining quota? Or just email? Lean toward more once the quota story is concrete.

## Cross-references

- Predecessor: `docs/architecture/transcript-cli.md` — module-landscape pattern this doc mirrors; the CLI's existing `Renderer` and `ExitCodeMapper` come from that work.
- Egress driver: `docs/youtube-tos-research.md` — why the frames pipeline can't run server-side.
- Downstream consumer: `docs/architecture/video-frames.md` (to be rewritten) — `extractFrames()` is invoked from this CLI entrypoint; the contract between them is part of [#87](https://github.com/niftymonkey/brief/issues/87)'s design.
- Industry-standard auth: [WorkOS CLI Auth docs](https://workos.com/docs/authkit/cli-auth), [RFC 8628 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628).
- Follow-up issue (planned): move LLM keys from CLI-side to server-issued ephemeral tokens, to unify the cost/quota story.
