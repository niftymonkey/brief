# Video Frames Architecture

Design pass for the video-frames integration — issue D in the `docs/video-frames-plan.md` breakdown. Depends on #84 (YouTube ToS posture), #85 (brief schema), #86 (model selection layer / pickai). Captures locked module boundaries and the trade-offs at the integration seam; the issue + its follow-up comment are the working source of truth, this document is the artifact.

## Executive summary

A single deep module — `@brief/core`'s `frames/` package — owns the 8-phase pipeline that turns a video ID into an *augmented transcript*: speech entries interleaved temporally with vision-extracted on-screen content. Its public surface is one function: `extractFrames()`. Its public type is one discriminated union: `FramesResult` with two cases, `included` and `attempted-failed`. The third planning-doc state, `not-requested`, is a route-level decision (don't call) rather than a return shape.

The web app brief route stays the orchestrator. It branches on the per-digest opt-in checkbox + allowlist, calls `extractFrames()` when both pass, falls back to the existing transcript-only path when frames return `attempted-failed`, and writes `transcript` (string), `framesStatus` (enum), and `metrics` (JSONB) onto the brief row regardless. `generateBrief()` learns one new thing: accept a pre-formatted transcript string in addition to the existing `TranscriptEntry[]` form, so frames-augmented and transcript-only digests reach the LLM through the same prompt template.

The 5-minute wall-clock fits inside the existing SSE stream — no background-job runner in v1. Allowlist scope (repo owner only) bounds the cost of getting that wrong; the route is the right place to revisit if real users get exposed.

Eight internal sub-modules sit behind `extractFrames()`: pure computation (`selection`, `weave`) tests directly; local-binary adapters (`ffmpeg`, `download`) record-and-replay; the Anthropic adapter is the one true external seam and gets a real port. The cost lever (cheap Haiku classifier filter before expensive Sonnet vision) is preserved by keeping `classify` and `vision` as separate functions inside the Anthropic adapter, not collapsed into one call.

## Why this design

The spike proved a specific pipeline shape works end-to-end on real content: ffmpeg scene detection + chapter + transcript-cue selection, paired cue+0/cue+3s captures, Haiku binary classifier, Sonnet VERBATIM/SUMMARY vision, temporal weave preserving formatting. The 4-round investigation in `continue-video-frames.md` records what works and what dead-ends to avoid (storyboards, Read-tool downsampling, MHTML rendering). The single reference implementation at `spikes/video-frames-pipeline/pipeline.mjs` is a working 8-phase orchestrator with disk caching — the production module *factors out of* this rather than reinventing it.

What the design fixes versus the spike:

- **Cache lives in the brief row, not on disk.** Disk caching across phases was an iteration accelerator during the spike. Production runs once per `(user, video)` and persists the augmented transcript to Postgres; no intermediate disk artifacts survive the request.
- **Cost cap is enforced inside `extractFrames()`.** The spike has no hard cap; production must guarantee ≤100 candidate frames per video as a v1 default.
- **Failure modes graceful.** The spike crashes on subprocess error; production downgrades to transcript-only and surfaces `framesStatus = 'attempted-failed'`.
- **Metrics are first-class.** The spike logs to stdout; production returns metrics in the result so the route can persist them.
- **Model choices route through pickai.** The spike hardcodes `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`; production reads from `packages/core/src/models.ts` (issue #86).

## Module landscape

### `packages/core/src/frames/`

| Module | Role |
|---|---|
| **`extractFrames()`** | Public surface. Single entry point. Returns `FramesResult`. Concentrates: phase sequencing, cost-cap enforcement, error-to-result translation, metrics aggregation. The deepest module in the design. |
| **`orchestrator`** | Internal. Runs phases sequentially. Threads a `MetricsAccumulator`. Owns the cost-cap check after `selection`. Catches per-phase errors and converts to `attempted-failed`. |
| **`selection`** | Pure. `(scenes, chapters, transcript, opts) → Candidate[]`. Concentrates: dedup window, source-priority ordering, cue-regex patterns, cue+3s pairing, video-start anchor. Determines which timestamps get extracted. |
| **`weave`** | Pure. `(transcript, visionResults) → string`. Concentrates: temporal interleave, transcript chunking (~12s), format preservation (no whitespace squash), `[MM:SS-MM:SS]` and `[MM:SS] [VISUAL]` markers. |
| **`ffmpeg`** | Local-binary adapter. Two functions: `detectScenes(videoPath, threshold)` and `extractFrameAt(videoPath, timestamp, outPath)`. Concentrates: ffmpeg argv assembly, stderr parsing for `pts_time`, subprocess error normalization. |
| **`download`** | Local-binary adapter. `downloadAt1080p(videoId, workDir) → { videoPath, infoJsonPath }`. Wraps yt-dlp. Concentrates: format selector string, output naming, info.json schema validation, ToS-relevant failure surfaces. |
| **`anthropic`** | True-external adapter. Two functions: `classify(framePath) → 'yes' \| 'no'` and `describe(framePath) → VisionResult`. Concentrates: image-content-block construction, API key handling, bounded concurrency (`pmap`), token-usage capture, per-frame retry. |
| **`types`** | `FramesResult` discriminated union, `Candidate`, `VisionResult`, `FramesOptions`, `FramesMetrics`. The interface the package presents to callers. |

### Deleted candidates (recorded so they don't get re-suggested)

- *`frames/sources/` abstraction for video bytes* — one adapter (yt-dlp) today is a hypothetical seam. The transcript fetcher's multi-source pattern is justified by two real adapters (`youtube-transcript-plus`, `supadata`); video bytes have no such second adapter. Inline the yt-dlp call into `frames/download.ts`. Revisit if issue #84 surfaces a vendor or alternate technique.
- *`frames/metrics/` as a separate module* — a `MetricsAccumulator` type and helper inside the orchestrator suffices. No leverage from a standalone module.
- *Separate `classifier` and `vision` modules* — both are Anthropic SDK calls with image content blocks; they share API key handling, base64 encoding, concurrency control, and error mapping. Different prompts and result shapes do not justify two adapter modules; they justify two functions inside one adapter.
- *Streaming-style result with per-frame events* — `extractFrames()` returns atomically. Progress to the SSE stream is the route's concern (it can emit `analyzing` events around `await extractFrames(...)` if granularity matters later). The frames module does not know about SSE.

### `apps/web` integration points

| Surface | Change |
|---|---|
| **`api/brief/route.ts`** | Reads `withFrames` from request body. Gated by `isFramesAllowed(user.email)` (parallel to existing `isEmailAllowed`). When both pass, calls `extractFrames()` after transcript fetch; otherwise uses the existing transcript-only path. Writes `transcript`, `framesStatus`, `metrics` to the brief row in all branches. |
| **`lib/summarize.ts`** | `generateBrief()` gains an overload to accept a pre-formatted transcript string. When the string form is used, it skips the internal `formatTimestamp` join. Prompt template is taught to recognize `[VISUAL]` markers (no structural change required — Sonnet handles them inline). |
| **`lib/prompts/user-template-chapters.md`** | One additional instruction line acknowledging `[VISUAL]` markers as on-screen content captures and treating verbatim sections as copy-pasteable. |
| **`lib/access.ts`** | New `isFramesAllowed(email)` constant, same shape as `isEmailAllowed`. Repo owner only in v1. |
| **`components/url-form` (or equivalent)** | New "Include video frames" checkbox, rendered only when `isFramesAllowed(user.email)`. Posts `withFrames: true` to the brief route. |

The DB columns (`transcript`, `framesStatus`, `metrics`) and migration land in issue #85, not here. The model-selection layer (`packages/core/src/models.ts`) lands in issue #86; this design assumes it exists at integration time and imports from it.

## Public interface

```typescript
// packages/core/src/frames/types.ts

export interface FramesOptions {
  videoId: string;
  transcript: TranscriptEntry[];        // from @brief/core's fetchTranscript
  chapters?: Chapter[] | null;          // from web app's extractChapters
  anthropicApiKey: string;
  workDir: string;                      // for video/frames; cleaned up by caller
  maxCandidates?: number;               // default 100
  signal?: AbortSignal;
}

export type FramesResult =
  | { kind: "included"; transcript: string; metrics: FramesMetrics }
  | { kind: "attempted-failed"; reason: FramesFailReason; phase: FramesPhase; message: string; metrics: FramesMetrics };

export type FramesFailReason =
  | "download-failed"        // yt-dlp non-zero, network out, video unavailable
  | "ffmpeg-failed"          // scene detection or frame extraction crashed
  | "vision-failed"          // Anthropic API exhausted retries or auth failed
  | "budget-exceeded"        // post-selection candidate count above cap
  | "aborted"                // signal triggered
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
  estimatedCostUsd: number;             // applied at the model-selection layer
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
- `transcript` (on the `included` kind) is the augmented form: existing speech entries interleaved with `[MM:SS] [VISUAL]` blocks. It is suitable for direct LLM input.
- No DB writes. No SSE awareness. No filesystem state outside `workDir`. Caller cleans up `workDir`.
- Bounded concurrency: classifier 5-wide, vision 4-wide (matches spike defaults; revisit with metrics).
- Cost cap: if `selection` produces more than `maxCandidates`, `extractFrames` returns `attempted-failed` with `reason: "budget-exceeded"` rather than running an expensive vision pass over a too-long video.

**Why this shape:**

- *One function, not a class.* No long-lived state. Each call is a unit of work matching a unit of user intent (one digest).
- *Transcript as input, not fetched internally.* The route already fetches the transcript before deciding whether to run frames; reusing the same fetch keeps frames decoupled from `@brief/core`'s transcript cascade.
- *Discriminated union over thrown errors.* The route distinguishes "frames failed, use transcript-only" from "everything failed, surface error" by reading `result.kind`, not by catching exceptions. Exception paths remain for programmer errors only — clear failure-mode contract.
- *Metrics always returned.* The route persists what's available regardless of outcome; partial metrics are useful for iteration ("we paid for 60 vision calls and then the weave step crashed").

## The integration seam

There is one real trade-off in this design. It lives at the boundary between `extractFrames()` and `generateBrief()`.

**Option A — String contract (recommended).** `FramesResult.transcript` is a pre-formatted string (`[MM:SS-MM:SS] speech` + `[MM:SS] [VISUAL] content` lines). `generateBrief()` gains a string-accepting form alongside the existing `TranscriptEntry[]` form, and the prompt template gets one line of guidance about `[VISUAL]` markers.

**Option B — Entry contract.** Extend `TranscriptEntry` to a sum type — `{ kind: 'speech', offset, duration, text } | { kind: 'visual', offset, mode: 'verbatim' | 'summary', text }`. `extractFrames()` returns entries. `generateBrief()` formats both kinds via its existing timestamp-formatting loop.

**Trade-off:**

| Lens | A (string) | B (entries) |
|---|---|---|
| **Leverage** | One additional `generateBrief` overload; format logic stays in `weave`. | Every consumer of `TranscriptEntry[]` (CLI, web, future chat) must teach itself about visuals. |
| **Locality** | Format changes (chunk size, marker style) live in `weave.ts`. Single owner. | Format changes ripple across `weave.ts` + `summarize.ts` + every renderer. |
| **Coupling** | The augmented format is part of the contract between `weave` and the brief prompt. The prompt template depends on `[VISUAL]` markers existing. | The augmented format is a structural property of the entry type. Renderers choose how to display. |
| **Future flexibility** | When/if the CLI thin-client (issue E) needs visuals, it consumes the same string. | The CLI thin-client could render visuals differently per output mode. |
| **Migration cost** | Low. One overload, one prompt-template tweak. | High. Type fans out into every existing transcript consumer. |
| **v1 risk** | Format drift between weave and prompt invalidates digests until matched. | Sum-type fan-out into legacy code paths (`SCHEMA_VERSION`, `formatTranscript`) requires deliberate migration. Risk of breaking the existing CLI JSON shape. |

**Recommendation: Option A.** The CLI JSON shape is explicitly frozen in v1 (planning doc decision #12 — `SCHEMA_VERSION` stays at `"1.0.0"`). Extending `TranscriptEntry` to a sum type would push that change through `format.ts`, the CLI renderer, and the existing web app's transcript handling — all in service of a feature gated to one user. Defer the entry-form migration until the CLI thin-client work (issue E), where the right JSON shape for visuals gets designed deliberately.

## Sync vs background

The 5-minute wall-clock budget (80 MB video download + ffmpeg + ~47 vision calls) fits inside the existing SSE stream. The route already streams `cached | metadata | transcript | analyzing | saving | complete | error` events; an `analyzing` event before `extractFrames()` and another before `generateBrief()` give the UI a progress signal across the longer wait.

**No background-job runner in v1.** Justifications:

- Allowlist scope (repo owner only) bounds the cost of being wrong about timeout behavior.
- Vercel/Next.js route timeout is configurable; existing route already runs minutes on transcript+brief generation for long videos. Frames extends the wall-clock but doesn't change the fundamental shape.
- A background-job runner adds: a job table, a worker process, status polling, SSE reconnection logic, and a "where's my brief?" page. None of that is cheap to build or operate.
- The right time to introduce one is when (a) the feature is generally available and (b) we have evidence that 5-minute requests time out in practice. Allowlist phase produces that evidence.

**Revisit when:** the feature comes off the allowlist, or any single phase consistently exceeds the route timeout, or the user wants to start a digest and walk away from the tab without losing the result.

## Failure-mode propagation

The route's contract with `extractFrames()`:

```typescript
const result = withFrames && isFramesAllowed(user.email)
  ? await extractFrames({ /* ... */ })
  : null;

if (result?.kind === "included") {
  const brief = await generateBrief(result.transcript, metadata, key, chapters);
  await saveBrief({ ..., transcript: result.transcript, framesStatus: "included", metrics: result.metrics });
} else if (result?.kind === "attempted-failed") {
  // Frames asked for but didn't deliver. Fall back to transcript-only.
  const brief = await generateBrief(transcript, metadata, key, chapters);
  await saveBrief({ ..., transcript: formatTranscript(transcript), framesStatus: "attempted-failed", metrics: result.metrics });
  // The metrics row records WHICH phase failed, so iteration can target it.
} else {
  // Not requested: existing path. framesStatus = 'not-requested', no metrics.
  const brief = await generateBrief(transcript, metadata, key, chapters);
  await saveBrief({ ..., transcript: formatTranscript(transcript), framesStatus: "not-requested" });
}
```

A `generateBrief` failure (Anthropic auth, rate limit, schema violation) is *not* a frames failure — it surfaces as the existing `error` SSE event. Frames failure only ever downgrades to transcript-only; it never blocks brief generation.

A second layer of resilience: even in the `attempted-failed` branch, if `transcript` happens to be empty (the route's transcript fetch came back unavailable), the existing transcript-only error path takes over. Frames don't entangle the existing error semantics.

## Dependency categories and test surface

| Module | Dependency category | Adapters | Test strategy |
|---|---|---|---|
| `selection` | 1 — In-process | None | Direct unit tests. Feed synthetic scenes + chapters + transcript, assert candidate timestamps and source-priority outcomes. Covers cue-regex patterns, dedup-window collisions, and chapter-interior ratios. |
| `weave` | 1 — In-process | None | Direct unit tests. Feed synthetic transcript + vision results, assert interleaved markdown structure. Format-preservation regression test (the spike's whitespace-squash bug) belongs here. |
| `ffmpeg` | 2 — Local-substitutable | Prod: real `ffmpeg`. Test: record fixture stderr/PNG once, replay. | Integration test with a small checked-in fixture clip (a few seconds, MIT-licensed sample) verifies subprocess invocation. Stderr-parsing unit-tested against recorded fixtures. |
| `download` | 2 — Local-substitutable | Prod: real `yt-dlp`. Test: skipped in CI; smoke-test target. | No CI test — networked. A `pnpm test:smoke` target hits a known video and asserts the produced `info.json` shape matches the validation schema. |
| `anthropic` | 4 — True external | Prod: `@anthropic-ai/sdk` client. Test: in-memory adapter returning canned classifier verdicts and vision results. | The adapter exposes an internal seam: a `MessagesClient` interface with one method (`createWithImage`). Production wires the real SDK; tests inject a stub. Two adapters justify the port. |
| `orchestrator` | Same as its constituents | Inherits from sub-modules | Tests use the in-memory anthropic adapter + recorded ffmpeg fixtures. Asserts: budget enforcement, error-to-result translation, metrics aggregation, cancellation. |
| `extractFrames` (public) | Aggregate | Same | Two contract-level tests: happy path (returns `included` with sane metrics) and budget overflow (returns `attempted-failed` with `reason: "budget-exceeded"` and zero vision tokens). Other failure modes covered at the orchestrator level. |

The **interface is the test surface**: callers and contract tests cross `extractFrames()`'s discriminated-union return. Internal seams (the `MessagesClient` port inside `anthropic.ts`) exist to make the deep module testable without standing up a network — they are not part of the public interface.

## Metrics surfacing

`FramesMetrics` is built up as the orchestrator moves through phases:

- `selection` reports `candidatesGenerated`, `candidatesAfterDedup`, and per-phase `wallClockMs`.
- `classify` reports `classifierYes`, `classifierNo`, `inputTokens`/`outputTokens` from `resp.usage`, `wallClockMs`.
- `vision` reports `visionCalls`, `visionVerbatim`, `visionSummary` (by parsing whether the response leads with `[Label]` + code-fence vs a prose paragraph — or by structured prompt-output marker, see open question), `inputTokens`/`outputTokens`, `wallClockMs`.
- `weave` reports `wallClockMs`.

`estimatedCostUsd` is computed at the model-selection layer (`packages/core/src/models.ts`) since unit pricing lives there.

The route persists the entire `FramesMetrics` blob into the brief row's `metrics` JSONB unmodified. v1 has no analytics consumer; the value is iteration data — "which phase is slow, which dominates cost, where do we tune."

## Open questions for issue D's implementation

These resolve during implementation, not at design time:

- **Verbatim vs summary mode reporting.** The spike's vision prompt leaves mode choice implicit (model autonomously picks). For metrics, the orchestrator needs to know which mode each result used. Either (a) parse the response shape after the fact (fragile), or (b) extend the prompt to emit a leading `<mode>verbatim</mode>` marker the adapter strips. (b) is more robust; decide during build.
- **`workDir` lifecycle.** Route creates a tempdir per request, passes to `extractFrames`, deletes after. Or `extractFrames` manages its own and returns nothing on disk. Latter is cleaner; the spike pattern is the former. Decide during build.
- **Cost-cap behavior on overflow.** Currently the design returns `attempted-failed`. Alternative: truncate to the highest-priority `maxCandidates` and proceed. The latter still delivers value for long videos; the former is more predictable. Lean toward predictable for v1, revisit with metrics.
- **Cancellation granularity.** `signal` aborts between phases. Inside ffmpeg/yt-dlp/concurrent vision calls, cancellation requires either `child_process` kill propagation or letting in-flight phases finish. Specify in implementation; the contract just promises "soonest possible cancellation."
- **Whether issue #84's findings change adapter design.** If the ToS research recommends a vendor download path or rate-limited approach, the `download` adapter's internal shape adjusts; the public interface of `frames/` does not.

## Cross-references

- Predecessor: `docs/video-frames-plan.md` — locked decisions, naming canon, requirements, constraints.
- Spike: `continue-video-frames.md` — 4-round investigation, dead ends, validated pipeline.
- Reference implementation: `spikes/video-frames-pipeline/pipeline.mjs` — single-file 8-phase orchestrator.
- Analogous prior design: `docs/architecture/transcript-cli.md` — same module-landscape format, same `@brief/core` package.
- Dependencies: #84 (ToS posture), #85 (schema), #86 (model selection).
- Downstream consumer: #36 ("Ask this video" chat) reads augmented transcripts from the brief row without doing its own vision work.
