# Video Frames — Implementation Phases

Execution plan for #87. Six phases, each shippable as a separate PR.

**Phase 1 is the only one strictly required to see augmented briefs working end-to-end.** Phases 2–6 add rigor (tests, port interfaces, polish, docs) incrementally. Each phase ships independently; you can pause after any of them.

Companion docs: `docs/video-frames-plan.md` (high-level), `docs/architecture/video-frames.md` (design).

## Phase 1 — Tracer bullet ("the lift")

**Deliverable:** augmented brief at `brief.niftymonkey.dev/brief/<id>` end-to-end. `brief generate --with-frames <url>` produces a brief that references on-screen content.

**Files to modify:**
- `packages/core/src/frames/index.ts` (new) — lifted from `spikes/video-frames-pipeline/pipeline.mjs`. Single file is fine for this phase.
- `packages/core/src/index.ts` — export `extractFrames` and `FramesResult` type.
- `packages/core/package.json` — add `@openrouter/ai-sdk-provider` if not already pulled in via `ai`.
- `apps/cli/src/handlers/run-generate.ts` — flip the `--with-frames` stub to call `extractFrames()` and include the augmented content in the submission.
- `apps/web/src/lib/cli-intake.ts` — when submission carries augmented content, pass it through to `generateBrief()` rather than filtering visuals out via `toFlatSpeechEntries`.
- `apps/web/src/lib/summarize.ts` — add an overload or branch on `generateBrief()` to accept a pre-formatted string in addition to `TranscriptEntry[]`.

**Reuse:**
- Models from `@brief/core` constants (`CLASSIFY_MODEL`, `VISION_MODEL`) — already exported.
- `formatTranscript(stub, "timestamped")` exists in `@brief/core` and produces the speech-only formatted string; the augmented path produces a similar string with `[VISUAL]` markers interleaved.
- `TranscriptSubmissionSchema` already has the `frames: { kind: "included", metrics }` discriminator — no schema changes.
- `TranscriptEntrySchema` already supports `kind: "visual"` entries — no schema changes.
- Migration 009 already applied locally and to prod — no DB changes.

**Adapter changes when lifting the spike:**
- Anthropic SDK → OpenRouter SDK (project standardized on OpenRouter in #86).
- Drop hardcoded video ID and `.env.local` path.
- Accept `openRouterApiKey` from caller instead of reading the env file.
- Accept `transcript: TranscriptEntry[]` and `chapters?: Chapter[]` as input instead of shelling out to the brief CLI for transcript.
- Wrap procedural script in `extractFrames(opts: FramesOptions): Promise<FramesResult>` returning the discriminated union per `docs/architecture/video-frames.md`.
- Replace `throw` paths with `kind: "attempted-failed"` returns carrying `reason` + `phase`.

**System-dep guard:** if `yt-dlp` or `ffmpeg` is absent from `PATH`, return `attempted-failed` with a helpful `reason` pointing at install docs. One subprocess existence check; not a full health probe.

**Not in scope:**
- Unit tests
- Refactor into the 8 sub-modules from the design doc
- Port interfaces / injectable adapters
- Cost cap enforcement, abort signal threading, per-phase wall-clock metrics
- Documentation updates

**Effort:** ~0.5–1.5 days. Most of that is manual smoke iterations (each is ~5 minutes of real yt-dlp + ffmpeg + vision calls).

**Verification:**
1. Run `pnpm --filter @brief/web dev` to start the local web server.
2. In another terminal: `pnpm cli:local generate https://www.youtube.com/watch?v=Bgxsx8slDEA --with-frames`.
3. Expect: progress lines for `Fetching transcript...`, `Extracting frames...`, `Generating brief on the server...`, then a `http://localhost:3000/brief/<id>` URL on stdout.
4. Open the brief URL; verify the brief content references visible-but-not-spoken content from the test video (the spike's A/B comparison documented these — pricing tables, config files, brainstorm names, etc.).
5. If the brief looks transcript-only despite frames being extracted, the prompt-handling path (in `generateBrief`) isn't using the augmented content — debug there before declaring victory.

## Phase 2 — Pure-module tests (cheap safety net)

**Deliverable:** regression-proof `selection` and `weave` logic so prompt/heuristic tuning is fearless.

**Files to modify:**
- `packages/core/src/frames/selection.ts` (new) — extract selection logic from `index.ts` as named exports.
- `packages/core/src/frames/selection.test.ts` (new) — unit tests.
- `packages/core/src/frames/weave.ts` (new) — extract weave logic from `index.ts`.
- `packages/core/src/frames/weave.test.ts` (new).
- `packages/core/src/frames/index.ts` — import from the new files.

**Test coverage:**
- `selection`: cue-regex patterns, dedup window (3s), cue+3s pairing, video-start anchor, chapter-interior 33%/67% ratios, source-priority ordering when candidates collide.
- `weave`: temporal interleave, transcript chunking (~12s), `[MM:SS-MM:SS]` and `[MM:SS] [VISUAL]` marker format, whitespace preservation (the spike's documented regression).

**Not in scope:** adapter ports, tests hitting ffmpeg/yt-dlp/network.

**Effort:** ~0.5 days.

**Why this phase second:** these two pieces have the most-likely-to-tune heuristics. Tests here give the fastest feedback loop for prompt and weave-format iteration.

## Phase 3 — Adapter port interfaces (testability foundation)

**Deliverable:** `download`, `ffmpeg`, `vision` exposed as injectable ports with production defaults wired. No behavior change.

**Files to modify:**
- `packages/core/src/frames/download.ts` (new) — yt-dlp wrapper exposed via a `DownloadAdapter` interface.
- `packages/core/src/frames/ffmpeg.ts` (new) — scene detection + frame extraction exposed via an `FfmpegAdapter` interface.
- `packages/core/src/frames/vision.ts` (new) — OpenRouter SDK adapter exposed via a `VisionClient` interface (one method: `describeImage(framePath): Promise<...>`).
- `packages/core/src/frames/orchestrator.ts` (new) — composes injected adapters, sequences phases.
- `packages/core/src/frames/types.ts` (new) — `FramesResult`, `Candidate`, `VisionResult`, `FramesOptions`, `FramesMetrics`.
- `packages/core/src/frames/index.ts` — production-adapter defaults; consumers can override.

**Not in scope:** stub adapter implementations, integration tests using them, cost cap, abort signal.

**Effort:** ~0.5–1 day.

**Why not earlier:** ports without a second adapter are just indirection. Phase 4's tests are the second adapter that makes the ports earn their keep.

## Phase 4 — Integration tests with stub adapters

**Deliverable:** `extractFrames()` and the orchestrator tested without ffmpeg/yt-dlp/network.

**Files to modify:**
- `packages/core/src/frames/orchestrator.test.ts` (new) — orchestrator tests with stub adapters.
- `packages/core/src/frames/index.test.ts` (new) — contract tests at the `extractFrames()` public surface (happy path, transient failure paths, budget overflow when phase 5's cost cap lands).
- Optional: `pnpm test:smoke` target in `packages/core/package.json` for real-network integration test (skipped in CI).

**Test coverage:**
- Error-to-result translation: each adapter throws → return `attempted-failed` with the right `phase`.
- Metrics aggregation across phases.
- Phase sequencing (download → ffmpeg → selection → classifier → vision → weave).
- Cancellation: `signal` mid-phase aborts the run.

**Effort:** ~1 day.

## Phase 5 — Production hardening (the polish)

**Deliverable:** the "responsibly built" version per the design doc.

**Files to modify:**
- `packages/core/src/frames/orchestrator.ts` — cost cap enforcement, abort signal threading.
- `packages/core/src/frames/types.ts` — `FramesMetrics` additions for per-phase wall-clock.
- `packages/core/src/frames/{download,ffmpeg,vision}.ts` — cancellation granularity for in-flight subprocesses + concurrent vision calls; better failure messages.
- `packages/core/src/frames/index.ts` — populate the `costSource: "cli-reported"` discriminator (schema already supports it).

**In scope:**
- Cost cap: configurable `maxCandidates`, returns `attempted-failed: budget-exceeded` when exceeded.
- Abort signal threaded through phases; cancellation granularity for in-flight ffmpeg/yt-dlp/vision.
- Per-phase metrics: `wallClockMs` per phase, `classifierYes`/`classifierNo` counts, `visionVerbatim`/`visionSummary` breakdown, `inputTokens`/`outputTokens`.
- Better failure-mode messages: anti-bot detection (`download-blocked-bot-detection`), video-not-public, ffmpeg subprocess crash, vision rate-limit retry.

**Not in scope:** documentation (phase 6).

**Effort:** ~1 day.

## Phase 6 — Docs + rollout decisions

**Deliverable:** the feature is documented and the rollout posture is explicit.

**Files to modify:**
- `docs/architecture/video-frames.md` — update to reflect what shipped vs the design.
- `continue.md` — mark #87 done.
- `apps/cli/src/main.ts` — update `--help` text for `--with-frames` (system deps, expected cost, expected time).
- `docs/video-frames-plan.md` — close out planning doc; mark feature shipped.
- Memory files — capture any lessons learned.

**Decision in this phase:** allowlist or per-day rate-limiting for augmented briefs? Tie into #94's quota work or punt?

**Effort:** ~0.5 days.

## Total

~4–5 days across all six phases. Phase 1 alone is ~0.5–1.5 days.

**Suggested merge cadence:**
- Phase 1 ships → run with it for a few days, observe edge cases.
- Phase 2 next session if you'll iterate on cues/weave.
- Phases 3–4 when CI failures on frames start mattering.
- Phase 5 when real users start hitting edge cases.
- Phase 6 always last; reflects what was actually built.

## Critical files to read before starting Phase 1

- `spikes/video-frames-pipeline/pipeline.mjs` — the source of the lift.
- `docs/architecture/video-frames.md` — the target shape and design constraints (invariants, public interface, failure-mode contract).
- `apps/cli/src/handlers/run-generate.ts` — where the `--with-frames` flag is parsed and where to flip the stub.
- `apps/web/src/lib/cli-intake.ts` — where the submission's `frames` discriminator is currently passed through.
- `apps/web/src/lib/summarize.ts` — `generateBrief()` signature; where the prompt template lives.
- `packages/core/src/submission.ts` — `TranscriptEntrySchema`, `TranscriptSubmissionSchema` (the sum-type wire format already supports visual entries).
- `packages/core/src/format.ts` — `formatTranscript` reference (the speech-only timestamped format we extend for the augmented path).
- `packages/core/src/models.ts` — `CLASSIFY_MODEL`, `VISION_MODEL`, `DIGEST_MODEL` exports.

## Verification (end-to-end, post-Phase 1)

1. Local web server: `pnpm --filter @brief/web dev` (port 3000).
2. Local CLI in dev mode: `pnpm cli:local generate https://www.youtube.com/watch?v=Bgxsx8slDEA --with-frames`.
3. Expected: progress on stderr, brief URL on stdout pointing at `http://localhost:3000/brief/<id>`.
4. Open the URL in a browser. Brief should contain references to on-screen content (pricing tables, config files, brainstorm names) from the test video.
5. Check `~/.config/brief/credentials.json` is intact and `brief whoami` still works against local.
6. Optional: `pnpm --filter @brief/core test` — confirms nothing pre-existing broke.
