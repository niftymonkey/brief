# Video Frames Plan

> **Status:** Decided. Foundational issues (#84, #85, #86, #91) landed. Architectural pivot 2026-05-11 moves the frames pipeline to the CLI; #87 and #88 are reshaped accordingly.
> **Last updated:** 2026-05-11
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
3. **Graceful-degrade failure mode** with `framesStatus` markers. CLI never crashes on a frames failure — it falls back to transcript-only output and surfaces the failure reason in stderr / metrics.
4. **Single `transcript` JSONB column** on `digests`. Content varies by submission: speech-only when `generate` is invoked without `--with-frames`; augmented (speech + `[VISUAL]` markers) when invoked with the flag.
5. **Single `framesStatus` enum:** `'included' | 'attempted-failed' | 'not-requested'`. Three values capture intent and outcome together.
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

## References

- `continue-video-frames.md` — technical spike doc (4 rounds complete) including the reference implementation at `spikes/video-frames-pipeline/pipeline.mjs` and concrete A/B output at `spikes/brief-ab-test/`.
- `docs/architecture/video-frames.md` — #87 design doc, CLI-runs-locally shape.
- `docs/architecture/cli-thin-client.md` — #88 design doc, auth + intake + submission shape.
- `docs/architecture/model-selection.md` — #86 design doc.
- `docs/llm-model-selection.md` — operational notes on the model-selection pipeline; locked picks.
- `docs/youtube-tos-research.md` — #84 deliverable; yellow verdict + ship conditions.
- Related GitHub issues: #36 (downstream "Ask this video" chat consumer), #73 (Postgres cache).
- WorkOS CLI Auth docs (for #88's auth flow): https://workos.com/docs/authkit/cli-auth
