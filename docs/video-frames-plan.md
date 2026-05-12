# Video Frames Plan

> **Status:** **Shipped (Phases 1–6 of #87 complete).** Augmented briefs are produced end-to-end via `brief generate --with-frames` and `brief transcript --with-frames`. See "What Shipped" below for the file-level landing summary.
> **Last updated:** 2026-05-12
> **Predecessor:** `continue-video-frames.md` (4-round technical spike)
> **Companion docs:** `docs/architecture/video-frames.md` (#87), `docs/architecture/cli-thin-client.md` (#88), `docs/youtube-tos-research.md` (#84), `docs/architecture/model-selection.md` (#86)

## Problem / Opportunity

Brief's digest pipeline feeds the LLM only the spoken transcript of a video. For visually-driven tutorials (slides, dashboards, IDE recordings, ad creative, on-screen prompts, brainstorming tables), this systematically loses information that's visible but never spoken — exactly the high-value detail viewers care about. A 4-round technical spike proved a pipeline that extracts frames at meaningful moments, runs them through a vision model, and weaves the results into the transcript produces dramatically richer digests. The A/B comparison on a real tutorial showed the augmented digest capturing exact pricing tables, rejected brainstorm names, Reddit ad creative copy, MRR numbers, and verbatim copy-pasteable system prompts — none in the transcript.

## Target Users

- **v1 launch surface:** brief CLI users (anyone who's signed in with WorkOS via `brief login`). The web app stays transcript-only in v1.
- **Eventual rollout:** CLI users are the only path to augmented briefs in the foreseeable future, by architectural necessity (see [Constraints](#constraints--boundaries)). The web app may grow a "view augmented brief" rendering surface but never a "generate augmented brief" trigger.
- **Downstream consumers:** "Ask this video" chat (#36) reads augmented transcripts from the brief row regardless of which client produced them.

## Core Requirements

**Must-have:**

- **Frames pipeline lives in `@brief/core/frames/` and is invoked exclusively by the CLI.** No server-side invocation of `extractFrames()` exists or is planned.
- **CLI subcommands** expose frames as an opt-in flag:
  - `brief transcript <url> --with-frames` — runs the local pipeline, prints the augmented transcript to stdout. No server contact.
  - `brief generate <url> --with-frames` — runs the local pipeline, submits the result to brief's hosted intake endpoint, returns the brief URL.
- **Frame selection pipeline:** ffmpeg scene detection at threshold 0.2 + chapter starts + chapter-interior 33%/67% + transcript-cue regex + paired cue+0/cue+3 anchors + classifier filter + vision pass (verbatim/summary mode chosen per-frame by the model).
- **Model choices** come from `@brief/core`'s `CLASSIFY_MODEL` and `VISION_MODEL` constants (locked picks in `docs/llm-model-selection.md`); no hardcoded model IDs in `frames/`.
- **Failure modes graceful:** pipeline failure → CLI downgrades to bare-transcript output (`transcript`) or transcript-only submission (`generate`); brief is still produced; row marked `frames_status = 'attempted-failed'`.
- **Cost cap:** max 100 candidates per video, v1 default. Revisit with metrics data.
- **Augmented transcript stored on the brief row** in the `transcript` JSONB column when shipped via `generate`. Per-brief generation metrics stored in the `metrics` JSONB column.
- **Public-only video acceptance.** The `download` adapter pre-flight-rejects private, unlisted, age-gated, and login-required videos. No cookie-jar bypass.
- **Transient video bytes.** Downloaded video bytes deleted in a `finally` block on every code path through `download`.

**Nice-to-have (deferred):**

- Server-issued ephemeral OpenRouter tokens to unify cost/quota accounting. v1 uses the user's own OpenRouter key from CLI env. Follow-up issue tracks the unification.
- Web-app rendering of augmented transcripts (showing `[VISUAL]` markers alongside speech in the brief view). Owned by a separate UI ticket.
- PKCE-loopback auth flow as an alternative to WorkOS device flow. v1 ships device flow only; the gh/gcloud-style "PKCE default, device fallback" pattern is a v2 enhancement to #88.

## Key Decisions Made

1. **v1 launches via the CLI only.** Web app stays transcript-only. The egress constraint (see [Constraints](#constraints--boundaries)) makes server-side frame extraction non-functional in production; pushing the pipeline to the user's machine via the CLI is the architectural response.
2. **Auth gating, not allowlist gating.** `brief generate` requires `brief login` (WorkOS device flow). Anyone signed in can run augmented briefs; quota/abuse are gated by per-account rate limits (v1: per-day cap on `generate` submissions), not by an email allowlist.
3. **Graceful-degrade failure mode** with `frames_status` markers. CLI never crashes on a frames failure — it falls back to transcript-only output and surfaces the failure reason in stderr / metrics.
4. **Single `transcript` JSONB column** on `digests`. Content varies by submission: speech-only when `generate` is invoked without `--with-frames`; augmented (speech + `[VISUAL]` markers) when invoked with the flag.
5. **Single `frames_status` enum:** `'included' | 'attempted-failed' | 'not-requested'`. Three values capture intent and outcome together.
6. **Replace on regenerate.** One brief per `(user, video)`. Submitting a new `generate` for the same video overwrites the previous brief.
7. **Pickai foundational, landed in #86.** `@brief/core` exports `DIGEST_MODEL`, `CLASSIFY_MODEL`, `VISION_MODEL`. Discover-candidates pipeline is in `packages/core/scripts/`. Locked picks documented in `docs/llm-model-selection.md`.
8. **Cost cap 100 candidates** per video as v1 default. Capture per-brief metrics in `metrics` JSONB column for data-driven iteration.
9. **YouTube ToS posture as a deep-research issue, landed in #84.** Yellow verdict: CLI-side egress is the architectural response that turns the yellow signal into a clean ship.
10. **Naming canon:**
    - User-facing feature: "video frames"
    - CLI flag: `--with-frames` (on `transcript` and `generate`)
    - Module path: `packages/core/src/frames/`
    - Public function: `extractFrames()` returning `FramesResult`
    - DB columns: `transcript`, `frames_status`, `metrics`
    - No web checkbox — there is no web UI surface for frames in v1
11. **CLI JSON shape bumps to `SCHEMA_VERSION = "2.0.0"`** as part of #88. `TranscriptEntry` becomes a discriminated union (`speech` | `visual`) to model augmented transcripts in machine-readable form. The bump happens once, in #88, and is reused by #87.
12. **Single hosted intake endpoint, `POST /api/brief/intake`** (defined in #88), accepts both transcript-only and augmented submissions via a discriminated `frames` field on the body. The endpoint runs `generateBrief()` synchronously and returns the brief URL.
13. **Vendor-mediated video-bytes download was evaluated and rejected.** No ethical vendor (under the "publicly owns the role" bar) cleanly delivers MP4-bytes-for-YouTube; see the [[frames-vendor-research]] memory and the architectural-pivot session notes. CLI-side residential-IP egress is the locked path.

## Constraints / Boundaries

- **Egress constraint (load-bearing).** Server-side yt-dlp from Vercel is reliably blocked by YouTube's anti-bot enforcement; #84's research established this is the dominant operational risk for any cloud-hosted invocation. CLI-side egress (the user's residential IP) sidesteps the constraint by structurally not being a datacenter IP. **This is why #87 lives in the CLI.**
- **Cost (CLI user pays in v1).** Each fresh augmented digest's LLM cost is paid by the CLI user's own OpenRouter account. Server-side brief generation cost is paid by brief's account. The split is temporary; the follow-up issue on server-issued tokens unifies billing.
- **Latency.** ~5 minutes wall-clock per fresh augmented digest including video download on a typical residential connection. The CLI's `generate` request's server-side phase is bounded by brief generation alone (transcript already in hand at submission time) — typically 5–15 s.
- **ToS.** CLI-side egress + transient bytes + public-only acceptance + no-cookies matches `docs/youtube-tos-research.md` §8.2's ship conditions for the allowlist phase; under the new architecture the "allowlist" is now "anyone signed in via `brief login`" since the per-user egress moves the operational risk off brief's infrastructure entirely. The published ToS at `/terms` (a separate gap closure) remains worth doing for user-notice and revocability reasons, but is no longer blocking the frames feature on the egress-friction side.
- **Schema additions are additive within `2.0.0`.** The bump from `1.0.0` happens once in #88. Inside `2.0.0`, all subsequent additions to the submission body must be optional or have server-side defaults.

## Issue Breakdown

| # | Title | Status | Notes |
|---|---|---|---|
| #84 | Research: YouTube ToS posture for video downloads | **Done** (PR #89) | Yellow verdict. Findings drove the architectural pivot in this session. |
| #85 | Brief schema foundations: `transcript` + `frames_status` + `metrics` columns | **Done** (PR #93) | Migration 009 applied; 30 existing rows backfilled. |
| #86 | Model selection layer: pickai + discover-candidates + migrate existing hardcode | **Done** (PR #92) | `DIGEST_MODEL`, `CLASSIFY_MODEL`, `VISION_MODEL` exports. OpenRouter as production transport. |
| #87 | Add video frames to brief generation (CLI-side pipeline) | **Reshaped** by pivot | Now depends on #88's auth + intake endpoint landing first. Frames module lives in `@brief/core/frames/` and is invoked by the CLI. No web-app integration. |
| #88 | CLI thin-client transition | **Reshaped** by pivot | Scope grows: was "CLI authenticates and submits briefs"; now also owns the intake-endpoint API contract and the `TranscriptEntry` sum-type migration. Must land before #87. |
| #90 | Evalite validation against locked role-model picks | **Filed** | Quality-improvement layer. Most-important thing to validate: the Anthropic `ifbench` anomaly. Doesn't block #87. |
| #91 | Migrate `apps/web` transcript fetching to `@brief/core` | **Done** (bundled into PR #93) | |

**Sequencing:** #88 → #87. #90 is parallel-grabbable at any time. The follow-up issue on server-issued OpenRouter tokens gets filed after #88 lands and the CLI-side flow proves out.

## Open Questions

- None at the design level. Architectural pivot (CLI-side pipeline + thin-client transition) is locked. Module boundaries are documented in the companion architecture docs.
- **Implementation-time decisions** (deferred to each issue's build pass): verbatim-vs-summary metrics surfacing, `workDir` lifecycle ownership, cost-cap-overflow behavior, cancellation granularity, anti-bot signature matching in the `download` adapter. All listed in the open-questions sections of `docs/architecture/video-frames.md` and `docs/architecture/cli-thin-client.md`.

## What Shipped (2026-05-12)

Six-phase landing on `feat/frames-phase-1`, one commit per phase. End-to-end smoke test confirmed VERBATIM mode firing on a real video (`Bgxsx8slDEA`): on-screen slash-commands, prompt templates, dashboard widget labels, and dated output filenames surface in the augmented brief that don't appear in the speech-only baseline.

- **Phase 1 — tracer-bullet lift.** `extractFrames()` ported from the spike into `packages/core/src/frames/index.ts`. Wired through `apps/cli/src/handlers/run-generate.ts` (server submission path) and the server intake adapter. Augmented transcript travels on `submission.frames.included.transcript` (string contract per the locked design decision).
- **Phase 2 — pure-module split + tests.** `selection.ts` (cue patterns, dedup, source priority, video-start anchor, chapter-interior ratios) and `weave.ts` (temporal interleave, 12-second chunking, `[VISUAL]` formatting, markdown-emphasis stripping with newline preservation) extracted as standalone modules. 36 unit tests across the two cover regex matching, dedup-window collisions, source-priority winner selection, chapter-interior ratios, boundary trim, transcript bucket flush thresholds, format markers, and the whitespace-preservation regression the spike documented.
- **Local cache** (alongside Phases 1–2). Per-`videoId` cache at `os.tmpdir()/brief-frames-cache/<videoId>/` — yt-dlp and ffmpeg both short-circuit on existing files, so re-runs against the same video skip the ~30s download and per-frame ffmpeg work. LLM calls re-run by design (prompt iteration would be useless if we cached them).
- **`transcript --with-frames` wired** (CLI-side, no server contact). Prints the augmented transcript to stdout — pipe-friendly. Falls back to speech-only on `attempted-failed` with a stderr note. Sets up future commands like `ask` that consume the augmented transcript via stdin.
- **Phase 3 — adapter port interfaces.** `download.ts` (yt-dlp + anti-bot signature regex + public-only gating), `ffmpeg.ts` (scene detection + frame extraction), `vision.ts` (OpenRouter classify + describe), and `orchestrator.ts` (phase sequencing) carved out behind injectable adapter interfaces. `index.ts` becomes a ~40-line public-surface wrapper that wires production-default adapters into the orchestrator.
- **Phase 4 — integration tests with stub adapters.** 17 orchestrator tests covering phase sequencing, error-to-result translation (each adapter's failure mode → the right `phase` + `reason`), metrics aggregation, cancellation. 2 public-surface contract tests (happy path returns `kind: "included"` with sane metrics; budget overflow returns `attempted-failed: budget-exceeded` with zero vision spend).
- **Phase 5 — production hardening + persistence.** Per-phase `wallClockMs` tallies stored in `FramesMetrics.phasesMs`. Vision results tagged with `verbatim` or `summary` mode via a structured `<mode>...</mode>` marker the model emits and the adapter strips. New `frames_metrics` JSONB column (migration `010_add_frames_metrics.sql`) persists the full `FramesMetrics` blob alongside the existing brief-generation metrics — separates "frames pipeline cost" from "digest LLM cost" cleanly.
- **Cost cap** (carried through from Phase 1, hardened by Phase 4 tests). `maxCandidates` default 100; selection returns `budget-exceeded` rather than running the vision pass over a too-long video. Tests verify zero LLM spend when the cap fires.
- **Auth-fix prerequisites.** Issues #100 (refresh-token redemption on 401-expired) and #101 (`expiresAt` written in seconds, legacy ms invalidated on read) shipped on a separate PR cherry-picked off `main` so they merge independently of the frames work. Without these, the CLI's WorkOS access tokens (5-min lifetime) would expire mid-run on long augmented-generate calls.

**Tests at end of #87:** 199 core / 136 CLI / 27 web — 362 total, all green.

**Deferred to follow-ups (intentional non-scope):**
- Subprocess kill-on-abort for in-flight yt-dlp / ffmpeg. Signal already checks between phases, which covers the common cancel case. Mid-subprocess cancellation requires switching from `execSync`/`spawnSync` to `spawn` + `.kill()` listeners; modest refactor, file as hardening issue if it ever bites.
- Vision rate-limit retry inside the adapter. Today a 429 fails the run; the orchestrator returns `vision-failed` and the CLI downgrades to transcript-only. Acceptable for v1.
- ~~The `brief ask <url> "<question>"` subcommand.~~ **Shipped.** First invocation builds + caches the augmented transcript via the per-`videoId` disk cache; subsequent calls reuse the cache for ~5–10s answers. Also supports a stdin-piped mode for `transcript --with-frames | brief ask "..."`.

## Rollout Decision

**Punted to the #94 follow-up.** The architecture doc lists "allowlist or per-day rate-limiting for augmented briefs" as a Phase 6 decision. Today, gating is implicit: anyone signed in via `brief login` can run augmented briefs, and the LLM cost lands on the CLI user's own OpenRouter account (`costSource: "cli-reported"`). That naturally caps abuse at the cost of being non-uniform across users. When #94 lands server-issued ephemeral OpenRouter tokens, the rate-limit decision becomes load-bearing — until then, the CLI-user-pays model is its own throttle.

## References

- `continue-video-frames.md` — technical spike doc (4 rounds complete) including the reference implementation at `spikes/video-frames-pipeline/pipeline.mjs` and concrete A/B output at `spikes/brief-ab-test/`.
- `docs/architecture/video-frames.md` — #87 design doc, CLI-runs-locally shape.
- `docs/architecture/cli-thin-client.md` — #88 design doc, auth + intake + submission shape.
- `docs/architecture/model-selection.md` — #86 design doc.
- `docs/llm-model-selection.md` — operational notes on the model-selection pipeline; locked picks.
- `docs/youtube-tos-research.md` — #84 deliverable; yellow verdict + ship conditions.
- Related GitHub issues: #36 (downstream "Ask this video" chat consumer), #73 (Postgres cache).
- WorkOS CLI Auth docs (for #88's auth flow): https://workos.com/docs/authkit/cli-auth
