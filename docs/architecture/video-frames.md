# Video Frames Architecture

> **Status (2026-05-12):** Phases 1–6 shipped on `feat/frames-phase-1`. The design described below landed substantially as written, with three differences worth noting up front: (a) the public surface includes injectable adapter overrides via `runFramesPipeline(opts, adapters)` so Phase 4 tests can stub `download`/`ffmpeg`/`vision` without the real subprocesses or OpenRouter; `extractFrames()` is a thin wrapper that wires production defaults. (b) Vision verbatim-vs-summary is detected via a structured `<mode>verbatim</mode>` / `<mode>summary</mode>` marker the prompt instructs the model to emit and the adapter strips — design open-question (b) resolved in favor of the structured-marker option. (c) `FramesMetrics` adds `phasesMs` (per-phase wall-clock) and `visionVerbatim`/`visionSummary` counts; persisted server-side in the new `frames_metrics` JSONB column (migration `010_add_frames_metrics.sql`). See `docs/video-frames-plan.md`'s "What Shipped" for the per-phase landing summary.

Design pass for the video-frames integration — issue [#87](https://github.com/niftymonkey/brief/issues/87). Depends on [#88](https://github.com/niftymonkey/brief/issues/88) (CLI thin-client transition, which provides the auth + submission shape this module plugs into). Captures locked module boundaries and the trade-offs at the integration seam; the issue + its follow-up comment are the working source of truth, this document is the artifact.

## Executive summary

A single deep module — `@brief/core`'s `frames/` package — owns the 8-phase pipeline that turns a video ID into an *augmented transcript*: speech entries interleaved temporally with vision-extracted on-screen content. Its public surface is one function: `extractFrames()`. Its public type is one discriminated union: `FramesResult` with two cases, `included` and `attempted-failed`. The third planning-doc state, `not-requested`, is a caller-level decision (don't call) rather than a return shape.

**The pipeline runs on the user's machine, invoked by the brief CLI's `transcript --with-frames` and `generate --with-frames` subcommands. The hosted web service never invokes `extractFrames()` and never touches YouTube video bytes.** This is the load-bearing constraint that shapes everything downstream: the egress problem documented in `docs/youtube-tos-research.md` (#84) means server-side yt-dlp from Vercel is reliably blocked by YouTube's anti-bot enforcement, and the vendor research summarized in the [[frames-vendor-research]] memory found no ethical vendor selling MP4-bytes-for-YouTube the way Supadata sells transcripts. The architectural response is to put the egress where it is structurally allowed — the user's residential IP — and surface the result back to the hosted service as a pre-prepared augmented transcript via the CLI thin-client API contract.

The CLI is the orchestrator. It branches on the `--with-frames` flag, calls `extractFrames()` when set, and either prints the augmented transcript (`brief transcript --with-frames`) or POSTs the augmented transcript + metrics to brief's hosted intake endpoint (`brief generate --with-frames`). The server's intake endpoint persists the submission and runs brief generation against it; it does not know or care whether the augmented transcript came from a frames pipeline or was hand-crafted.

Eight internal sub-modules sit behind `extractFrames()`: pure computation (`selection`, `weave`) tests directly; local-binary adapters (`ffmpeg`, `download`) record-and-replay; the OpenRouter vision adapter is the one true external seam and gets a real port. The cost lever (cheap classifier filter before expensive vision) is preserved by keeping `classify` and `vision` as separate functions inside the OpenRouter adapter, not collapsed into one call.

## Why this design

The spike proved a specific pipeline shape works end-to-end on real content: ffmpeg scene detection + chapter + transcript-cue selection, paired cue+0/cue+3s captures, classifier binary verdict, vision VERBATIM/SUMMARY pass, temporal weave preserving formatting. The 4-round investigation in `continue-video-frames.md` records what works and what dead-ends to avoid (storyboards, Read-tool downsampling, MHTML rendering). The single reference implementation at `spikes/video-frames-pipeline/pipeline.mjs` is a working 8-phase orchestrator with disk caching — the production module *factors out of* this rather than reinventing it.

What the design fixes versus the spike:

- **Runs CLI-side, not server-side.** The spike ran on the developer's machine and that is the production environment. The web app stays transcript-only; frames are exclusively a CLI capability in v1.
- **Cache lives in the brief row on the hosted server, not on disk.** Disk caching across phases was an iteration accelerator during the spike. Production runs once per `(user, video)` on the user's machine, ships the augmented transcript to the hosted service, and the hosted service persists to Postgres. No intermediate disk artifacts survive past the CLI process exit.
- **Cost cap is enforced inside `extractFrames()`.** The spike has no hard cap; production must guarantee ≤100 candidate frames per video as a v1 default.
- **Failure modes graceful.** The spike crashes on subprocess error; production downgrades to bare-transcript output (CLI) or transcript-only submission (CLI → server) and surfaces `kind: "attempted-failed"` with the failing phase.
- **Metrics are first-class.** The spike logs to stdout; production returns metrics in the result so the CLI can include them in the server submission.
- **Model choices route through `@brief/core`'s model layer.** The spike hardcoded Anthropic Claude models; production reads `CLASSIFY_MODEL` and `VISION_MODEL` from `packages/core/src/models.ts` (issue #86, locked picks documented in `docs/llm-model-selection.md`).

## Module landscape

### `packages/core/src/frames/`

| Module | Role |
|---|---|
| **`extractFrames()`** | Public surface. Single entry point. Returns `FramesResult`. Concentrates: phase sequencing, cost-cap enforcement, error-to-result translation, metrics aggregation. The deepest module in the design. |
| **`orchestrator`** | Internal. Runs phases sequentially. Threads a `MetricsAccumulator`. Owns the cost-cap check after `selection`. Catches per-phase errors and converts to `attempted-failed`. |
| **`selection`** | Pure. `(scenes, chapters, transcript, opts) → Candidate[]`. Concentrates: dedup window, source-priority ordering, cue-regex patterns, cue+3s pairing, video-start anchor. Determines which timestamps get extracted. |
| **`weave`** | Pure. `(transcript, visionResults) → string`. Concentrates: temporal interleave, transcript chunking (~12s), format preservation (no whitespace squash), `[MM:SS-MM:SS]` and `[MM:SS] [VISUAL]` markers. |
| **`ffmpeg`** | Local-binary adapter. Two functions: `detectScenes(videoPath, threshold)` and `extractFrameAt(videoPath, timestamp, outPath)`. Concentrates: ffmpeg argv assembly, stderr parsing for `pts_time`, subprocess error normalization. |
| **`download`** | Local-binary adapter. `downloadAt1080p(videoId, workDir) → { videoPath, infoJsonPath }`. Wraps yt-dlp. Concentrates: format selector string, output naming, info.json schema validation, public-only pre-flight rejection, anti-bot challenge detection. Never passes `--cookies` or any cookie-jar argument; cookie-authenticated pulls are out of scope per `docs/youtube-tos-research.md` §8.2.6. Video bytes deleted in a `finally` block on every code path. |
| **`vision`** | True-external adapter via OpenRouter. Two functions: `classify(framePath) → 'yes' \| 'no'` and `describe(framePath) → VisionResult`. Concentrates: image-content-block construction, API key handling (caller-supplied, from CLI environment), bounded concurrency (`pmap`), token-usage capture, per-frame retry. |
| **`types`** | `FramesResult` discriminated union, `Candidate`, `VisionResult`, `FramesOptions`, `FramesMetrics`. The interface the package presents to callers. |

### Deleted candidates (recorded so they don't get re-suggested)

- *`frames/sources/` abstraction for video bytes* — one adapter (yt-dlp) today is a hypothetical seam. The transcript fetcher's multi-source pattern is justified by two real adapters (`youtube-transcript-plus`, `supadata`); video bytes have no such second adapter, and vendor research (see [[frames-vendor-research]]) found none clean enough to consider. Inline the yt-dlp call into `frames/download.ts`.
- *`frames/metrics/` as a separate module* — a `MetricsAccumulator` type and helper inside the orchestrator suffices.
- *Separate `classifier` and `vision` modules* — both are vision-LLM calls with image content blocks; they share API key handling, base64 encoding, concurrency control, and error mapping. Different prompts and result shapes do not justify two adapter modules; they justify two functions inside one adapter.
- *Streaming-style result with per-frame events* — `extractFrames()` returns atomically. Progress display in the CLI is the CLI's concern (it can print `analyzing` / `vision` progress lines around `await extractFrames(...)` if granularity matters). The frames module does not know about CLI rendering.
- *Vendor-mediated download adapter* — explored during the architectural pivot session (2026-05-11). No vendor in the market cleanly delivers MP4-bytes-for-YouTube under the user's ethical bar (named public-facing developer product, not residential-proxy network). Architecture response was to move the egress to the user's machine via the CLI. The download adapter wraps yt-dlp directly on the user's residential IP; no vendor abstraction.
- *Web-app integration of `extractFrames()`* — the original design called this from the brief route handler. The egress constraint (datacenter-IP blocking) makes this non-functional in production. The web app stays transcript-only; the CLI is the only invocation point.

### `apps/cli` integration points

| Surface | Change |
|---|---|
| **`brief transcript <url> --with-frames`** | Local-only. Calls `extractFrames()` after transcript fetch, renders the augmented transcript to stdout. No server contact. Useful for iterating on the frames pipeline without burning a brief generation. |
| **`brief generate <url> --with-frames`** | Calls `extractFrames()` after transcript fetch, builds a `TranscriptSubmission` with `frames.kind = "included"` (or `"attempted-failed"`), POSTs to `/api/brief/intake`. Server treats the augmented transcript as pre-prepared and runs brief generation. |
| **`apps/cli/src/handlers/runTranscript.ts`** (new) | The `transcript` subcommand handler. Calls `fetchTranscript` then optionally `extractFrames`. Renders to stdout. |
| **`apps/cli/src/handlers/runGenerate.ts`** (new) | The `generate` subcommand handler. Same prelude as `runTranscript`, then builds a submission and POSTs via `HostedClient.submit()`. |

The DB columns (`transcript`, `frames_status`, `metrics`) and migration shipped in #85 (PR #93). The model-selection layer (`packages/core/src/models.ts`) shipped in #86 (PR #92). The CLI auth + submission shape ship in #88. This issue (#87) lands the frames module and its two CLI handler integrations on top of that foundation.

### `apps/web` integration points

**None for #87.** The web app's brief route remains transcript-only. There is no "include video frames" checkbox in the URL form; there is no `isFramesAllowed` allowlist; there is no `framesQuotaRemaining` rate-limit gate. All of that scope existed under the prior server-side-orchestration design and is removed by the CLI-runs-locally pivot.

The hosted intake endpoint (`POST /api/brief/intake`, defined by #88) receives augmented transcripts from the CLI without distinguishing them from transcript-only submissions at the routing layer — the discriminator is on the request body's `frames` field. The brief route writes `frames_status = 'included'` for augmented submissions and `'not-requested'` for plain ones; the existing `frames_status = 'attempted-failed'` value carries through when the CLI ships a failure result.

## Public interface

```typescript
// packages/core/src/frames/types.ts

export interface FramesOptions {
  videoId: string;
  transcript: TranscriptEntry[];        // from @brief/core's fetchTranscript
  chapters?: Chapter[] | null;          // from @brief/core's extractChapters
  openRouterApiKey: string;             // caller-supplied; CLI reads from env
  workDir: string;                      // for video/frames; cleaned up by caller
  maxCandidates?: number;               // default 100
  signal?: AbortSignal;
}

export type FramesResult =
  | { kind: "included"; transcript: string; metrics: FramesMetrics }
  | { kind: "attempted-failed"; reason: FramesFailReason; phase: FramesPhase; message: string; metrics: FramesMetrics };

export type FramesFailReason =
  | "download-blocked-bot-detection"  // YouTube anti-bot challenge / unexpected from residential IP, but not impossible
  | "video-not-public"                // private, unlisted, age-gated, or login-required (rejected pre-download)
  | "download-failed"                 // yt-dlp non-zero for any other reason (network, removed, geo, etc.)
  | "ffmpeg-failed"                   // scene detection or frame extraction crashed
  | "vision-failed"                   // vision API exhausted retries or auth failed
  | "budget-exceeded"                 // post-selection candidate count above cap
  | "aborted"                         // signal triggered
  | "unknown";

export type FramesPhase =
  | "download" | "scene-detection" | "selection"
  | "extraction" | "classify" | "vision" | "weave";

export interface FramesMetrics {
  videoDurationSec: number;
  candidatesGenerated: number;
  candidatesAfterDedup: number;
  classifierYes: number;
  classifierNo: number;
  visionCalls: number;
  visionVerbatim: number;
  visionSummary: number;
  inputTokens: number;
  outputTokens: number;
  classifierModel: string;
  visionModel: string;
  wallClockMs: number;
  phasesMs: Record<FramesPhase, number>;
}

// packages/core/src/frames/index.ts
export function extractFrames(opts: FramesOptions): Promise<FramesResult>;
```

**Invariants:**

- `extractFrames` does not throw under normal failure conditions. Every failure becomes `attempted-failed` with a `reason` and `phase`. Exceptions propagate only for programmer errors (bad inputs, missing API key, signal misuse).
- `metrics` is returned on both result kinds. Failures still record what got measured before bailing.
- `transcript` (on the `included` kind) is the augmented form: existing speech entries interleaved with `[MM:SS] [VISUAL]` blocks. It is suitable for direct LLM input or for CLI rendering to stdout.
- No DB writes. No network hops beyond `download` (yt-dlp's YouTube fetch) and `vision` (OpenRouter). No filesystem state outside `workDir`. Caller cleans up `workDir`.
- Bounded concurrency: classifier 5-wide, vision 4-wide (matches spike defaults; revisit with metrics).
- Cost cap: if `selection` produces more than `maxCandidates`, `extractFrames` returns `attempted-failed` with `reason: "budget-exceeded"` rather than running an expensive vision pass over a too-long video.
- **Public-only acceptance.** Private, unlisted, age-gated, and login-required videos are rejected by the `download` adapter's pre-flight check; result is `attempted-failed` with `reason: "video-not-public"` and `phase: "download"`. The pipeline does not attempt to bypass any access control.
- **Transient bytes.** Downloaded video bytes are deleted in a `finally` block on every code path through `download` — success, failure, or abort. No code path retains the path after `extractFrames()` returns.
- **No cookies.** The `download` adapter never accepts a cookie jar, `--cookies` argument, or YouTube session credential. Cookie-authenticated pulls are out of scope per `docs/youtube-tos-research.md` §8.2.6.
- **No external orchestration awareness.** The module does not know whether it's being called from `transcript` or `generate`, whether the caller will print the result or POST it to a server, whether there's an authenticated user or not. It returns a `FramesResult` and walks away.

**Why this shape:**

- *One function, not a class.* No long-lived state. Each call is a unit of work matching a unit of user intent (one CLI invocation).
- *Transcript as input, not fetched internally.* The CLI handler already fetches the transcript before deciding whether to run frames; reusing the same fetch keeps frames decoupled from `@brief/core`'s transcript cascade.
- *Discriminated union over thrown errors.* The CLI distinguishes "frames failed, fall back to bare transcript" from "everything failed, exit non-zero" by reading `result.kind`, not by catching exceptions.
- *Metrics always returned.* The CLI persists what's available to the server submission regardless of outcome; partial metrics are useful for iteration ("we paid for 60 vision calls and then the weave step crashed").

## The CLI ↔ frames seam

`extractFrames()` is invoked from the CLI's `transcript` and `generate` handlers. The two handlers consume the same `FramesResult` but render it differently:

| Result kind | `runTranscript` behavior | `runGenerate` behavior |
|---|---|---|
| `kind: "included"` | Print the augmented transcript (`result.transcript`) to stdout. Exit 0. | Build a `TranscriptSubmission` with `frames.kind = "included"` carrying `result.metrics`. POST to `/api/brief/intake`. Print the returned brief URL on stdout. Exit 0. |
| `kind: "attempted-failed"` | Print the original transcript (transcript-only) to stdout. Print the failure reason + phase to stderr as a one-line note. Exit 0 (transcript still succeeded). | Build a `TranscriptSubmission` with `frames.kind = "attempted-failed"` carrying the failure reason/phase + partial metrics. POST. The server produces a transcript-only brief; the failure surfaces in the row's `metrics` JSONB for later iteration. Exit 0. |

Frames-pipeline failures never fail the CLI run. They downgrade the output. This matches the failure-mode contract designed for `extractFrames()` and is what makes `--with-frames` safe to flip on — worst case you get a transcript-only result with a stderr note, never a crash.

## The integration seam to `generateBrief()`

The hosted intake endpoint (defined by #88) receives a `TranscriptSubmission` carrying either a transcript-only payload or a transcript-plus-augmented-string payload. The intake handler normalizes both into the same input shape for `generateBrief()`, which lives server-side in `apps/web/src/lib/summarize.ts`.

**Locked decision: string contract over entry contract.** The augmented transcript ships as a pre-formatted string (`[MM:SS-MM:SS] speech` + `[MM:SS] [VISUAL] content` lines) in the submission. `generateBrief()` consumes the string directly when present; otherwise it formats `TranscriptEntry[]` via `formatTranscript(..., "timestamped")` as it does today. The prompt template gains one line of guidance about `[VISUAL]` markers being on-screen content captures.

The alternative — extending `TranscriptEntry` to a discriminated union of `speech` and `visual` entries — *is* still happening, but for a different reason: #88 needs the sum-type to model what the CLI emits in its JSON output (`brief transcript --json`) and what flows across the submission boundary. The point of locking the string contract for `generateBrief()` specifically is that the *prompt input* doesn't need to traffic in sum-type entries — a flat formatted string is exactly the shape LLMs already consume well. Sum-type entries are useful for *programmatic* consumers (the CLI's own JSON output, the future thin-client web rendering of augmented transcripts); they're not useful for prompt construction.

## Failure-mode propagation

The CLI handler's contract with `extractFrames()`:

```typescript
// Pseudocode of runGenerate's frames branch.

const frames = opts.withFrames
  ? await extractFrames({ videoId, transcript: transcript.entries, openRouterApiKey, workDir, signal })
  : { kind: "not-requested" as const };

const submission: TranscriptSubmission = {
  schemaVersion: SCHEMA_VERSION,
  videoId,
  metadata,
  transcript: transcript.entries,           // TranscriptEntry[] — sum-type entries from #88
  frames:
    frames.kind === "included"        ? { kind: "included", metrics: frames.metrics }
  : frames.kind === "attempted-failed" ? { kind: "attempted-failed", reason: frames.reason, phase: frames.phase, metrics: frames.metrics }
  :                                      { kind: "not-requested" },
};

const result = await hostedClient.submit(submission);
// ...handle BriefResult (see #88's design).
```

A `generateBrief()` failure on the server (transient LLM failure, schema violation) surfaces as `BriefResult.kind === "transient"` in the CLI. Frames failure only ever downgrades to transcript-only; it never blocks brief generation. A transcript fetch failure (`unavailable` / `transient`) short-circuits both handlers before `extractFrames()` is even attempted — frames cannot run without a transcript.

## Dependency categories and test surface

| Module | Dependency category | Adapters | Test strategy |
|---|---|---|---|
| `selection` | 1 — In-process | None | Direct unit tests. Feed synthetic scenes + chapters + transcript, assert candidate timestamps and source-priority outcomes. Covers cue-regex patterns, dedup-window collisions, and chapter-interior ratios. |
| `weave` | 1 — In-process | None | Direct unit tests. Feed synthetic transcript + vision results, assert interleaved markdown structure. Format-preservation regression test (the spike's whitespace-squash bug) belongs here. |
| `ffmpeg` | 2 — Local-substitutable | Prod: real `ffmpeg`. Test: record fixture stderr/PNG once, replay. | Integration test with a small checked-in fixture clip (a few seconds, MIT-licensed sample) verifies subprocess invocation. Stderr-parsing unit-tested against recorded fixtures. |
| `download` | 2 — Local-substitutable | Prod: real `yt-dlp`. Test: skipped in CI; smoke-test target. | No CI test — networked. A `pnpm test:smoke` target hits a known video and asserts the produced `info.json` shape matches the validation schema, plus that public-only and bot-detection rejection paths return the right `FramesFailReason`. |
| `vision` | 4 — True external | Prod: OpenRouter via `@openrouter/ai-sdk-provider`. Test: in-memory adapter returning canned classifier verdicts and vision results. | The adapter exposes an internal seam: a `VisionClient` interface with one method (`describeImage`). Production wires the real provider; tests inject a stub. |
| `orchestrator` | Same as its constituents | Inherits from sub-modules | Tests use the in-memory vision adapter + recorded ffmpeg fixtures. Asserts: budget enforcement, error-to-result translation, metrics aggregation, cancellation. |
| `extractFrames` (public) | Aggregate | Same | Two contract-level tests: happy path (returns `included` with sane metrics) and budget overflow (returns `attempted-failed` with `reason: "budget-exceeded"` and zero vision tokens). Other failure modes covered at the orchestrator level. |

The **interface is the test surface**: callers and contract tests cross `extractFrames()`'s discriminated-union return. Internal seams (the `VisionClient` port inside `vision.ts`) exist to make the deep module testable without standing up a network — they are not part of the public interface.

## Metrics surfacing

`FramesMetrics` is built up as the orchestrator moves through phases:

- `selection` reports `candidatesGenerated`, `candidatesAfterDedup`, and per-phase `wallClockMs`.
- `classify` reports `classifierYes`, `classifierNo`, `inputTokens`/`outputTokens` from `resp.usage`, `wallClockMs`.
- `vision` reports `visionCalls`, `visionVerbatim`, `visionSummary` (by parsing whether the response leads with `[Label]` + code-fence vs a prose paragraph — or by structured prompt-output marker, see open question), `inputTokens`/`outputTokens`, `wallClockMs`.
- `weave` reports `wallClockMs`.

Currency-agnostic shape per [[currency-agnostic-metrics]] (the decision from #85): the metrics blob stores tokens, model, and latency only. Cost is derived on demand via `estimateCost(model, in, out)` from `@brief/core`. v1 has no dashboard for this data; the value is iteration — "which phase is slow, which dominates cost, where do we tune."

The CLI persists the entire `FramesMetrics` blob into the brief row's `metrics` JSONB unmodified via the submission. There is a known limitation: in v1, the cost values derived from CLI-side LLM calls are *self-reported* — the server cannot independently verify token counts because it didn't make the calls. The `FramesMetrics` blob includes a `costSource: "cli-reported"` field (defined on `FramesMetricsSchema` in `docs/architecture/cli-thin-client.md`). The follow-up issue on server-issued ephemeral tokens (planned) broadens this to `costSource: "server-issued"` and makes the values trustable for billing/quota purposes.

## Open questions for issue #87's implementation

These resolve during implementation, not at design time:

- **Verbatim vs summary mode reporting.** The spike's vision prompt leaves mode choice implicit (model autonomously picks). For metrics, the orchestrator needs to know which mode each result used. Either (a) parse the response shape after the fact (fragile), or (b) extend the prompt to emit a leading `<mode>verbatim</mode>` marker the adapter strips. (b) is more robust; decide during build.
- **`workDir` lifecycle.** CLI handler creates a tempdir per request, passes to `extractFrames`, deletes after. Or `extractFrames` manages its own and returns nothing on disk. Latter is cleaner; the spike pattern is the former. Decide during build.
- **Cost-cap behavior on overflow.** Currently the design returns `attempted-failed`. Alternative: truncate to the highest-priority `maxCandidates` and proceed. The latter still delivers value for long videos; the former is more predictable. Lean toward predictable for v1, revisit with metrics.
- **Cancellation granularity.** `signal` aborts between phases. Inside ffmpeg/yt-dlp/concurrent vision calls, cancellation requires either `child_process` kill propagation or letting in-flight phases finish. Specify in implementation; the contract just promises "soonest possible cancellation."
- **Anti-bot detection signature matching.** The `download` adapter needs to distinguish `download-blocked-bot-detection` from other download failures via stderr signature. The patterns in [yt-dlp issue #10128](https://github.com/yt-dlp/yt-dlp/issues/10128) (notably "Sign in to confirm you're not a bot" + HTTP 429 from suspicious-IP ranges) are the starting point. The CLI's run from a residential IP makes this rare but not impossible (some networks are flagged), so the signal is still worth surfacing distinctly.

## Cross-references

- Predecessor (planning): `docs/video-frames-plan.md` — locked decisions, naming canon, requirements, constraints.
- Spike: `continue-video-frames.md` — 4-round investigation, dead ends, validated pipeline.
- Reference implementation: `spikes/video-frames-pipeline/pipeline.mjs` — single-file 8-phase orchestrator.
- ToS / egress driver: `docs/youtube-tos-research.md` — why this pipeline runs CLI-side, not server-side.
- CLI integration: `docs/architecture/cli-thin-client.md` (#88) — the auth + submission shape this module's output flows into.
- Model-selection layer: `docs/architecture/model-selection.md` (#86) — provides `CLASSIFY_MODEL` and `VISION_MODEL`.
- Schema foundation: PR #93 — `transcript`, `metrics`, `frames_status` columns on `digests`.
- Downstream consumer: #36 ("Ask this video" chat) reads augmented transcripts from the brief row without doing its own vision work.
