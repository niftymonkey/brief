# Video Frames Plan

> **Status:** Decided. Ready for issue filing.
> **Last updated:** 2026-05-10
> **Predecessor:** `continue-video-frames.md` (4-round technical spike)

## Problem / Opportunity

Brief's digest pipeline feeds the LLM only the spoken transcript of a video.
For visually-driven tutorials (slides, dashboards, IDE recordings, ad creative,
on-screen prompts, brainstorming tables), this systematically loses information
that's visible but never spoken — exactly the high-value detail viewers care
about. A 4-round technical spike proved a pipeline that extracts frames at
meaningful moments, runs them through a vision model, and weaves the results
into the transcript produces dramatically richer digests at ~$0.50/video. The
A/B comparison on a real tutorial showed the augmented digest capturing exact
pricing tables, rejected brainstorm names, Reddit ad creative copy, MRR numbers,
and verbatim copy-pasteable system prompts — none in the transcript.

## Target Users

- **Initial dogfooding (allowlist phase):** repo owner only.
- **Eventual rollout:** all brief users.
- **Downstream consumers:** "Ask this video" chat (#36), digest renderer,
  future CLI thin-client.

## Core Requirements

**Must-have:**

- Web app digest pipeline picks up augmented input (transcript + interleaved
  visual descriptions) when an allowlisted user opts in via a per-digest
  checkbox on the URL input form. No other UI changes.
- Frame selection pipeline: ffmpeg scene detection at threshold 0.2 + chapter
  starts + chapter-interior 33%/67% + transcript-cue regex + paired cue+0/cue+3
  anchors + Haiku 4.5 classifier filter + Sonnet 4.6 vision (verbatim/summary
  mode chosen per-frame by the model).
- Failure modes graceful: pipeline failure → fall back to transcript-only;
  brief is still produced; row marked `framesStatus = 'attempted-failed'`.
- Cost cap: max 100 candidates per video, v1 default. Revisit with metrics
  data.
- Augmented transcript stored on the brief row (in `transcript` column).
- Per-brief generation metrics stored on the brief row (in `metrics` JSONB
  column).
- Foundational work parallel-grabbable: transcript schema, pickai, and ToS
  research can be picked up by agents simultaneously, in any order.

**Nice-to-have (deferred):**

- CLI surface for video frames — deferred to the CLI thin-client work.
- Reactive two-pass extraction for the chat consumer — owned by future #36
  follow-up.
- Refinements to cue alignment, classifier prompt, vision prompt — left for
  iteration after first ship.

## Key Decisions Made

1. **v1 = web app digest pipeline only.** No CLI changes in v1. CLI keeps
   today's behavior; thin-client transition is separate (issue E).
2. **Opt-in per-digest** via checkbox on the URL form. Default off.
3. **Allowlist gating** reuses the existing `isEmailAllowed` pattern (or a
   parallel `isFramesAllowed` constant).
4. **Graceful-degrade failure mode** with `framesStatus` markers. Existing
   `RetryPolicy` shape reused for retries.
5. **Single `transcript` column** on briefs — no separate `augmentedTranscript`.
   Content varies by run: speech-only when not requested or failed; interleaved
   with visuals when requested and succeeded.
6. **Single `framesStatus` enum:** `'included' | 'attempted-failed' |
   'not-requested'`. Three values capture intent and outcome together.
7. **Replace on regenerate.** One brief per `(user, video)`. Toggling the
   checkbox and regenerating overwrites the previous brief.
8. **Pickai foundational, not deferred.** Build a `discover-candidates.ts` for
   brief modeled on the prior art in `champ-sage/` and `review-kit/`.
   Centralize all model choices in `packages/core/src/models.ts`. Migrate the
   existing `summarize.ts:211` hardcode through the same module — opportunistic
   cleanup.
9. **Cost cap 100 candidates** per video as v1 default. Capture per-brief
   metrics in `metrics` JSONB column for data-driven iteration.
10. **YouTube ToS posture as a deep-research issue.** Output is a research doc,
    not code. Findings inform whether/how the feature ships and what
    user-facing ToS changes might be needed on brief itself.
11. **Naming canon:**
    - User-facing feature: "video frames"
    - CLI flag (when CLI work happens): `--with-frames`
    - Module path: `packages/core/src/frames/`
    - Public function: `extractFrames()` returning `FramesResult`
    - DB columns: `transcript`, `framesStatus`, `metrics`
    - Web checkbox label: "Include video frames"
12. **CLI JSON shape unchanged in v1.** `SCHEMA_VERSION` stays at `"1.0.0"`.
    No new fields, no new `frames` block. The augmented apparatus lives
    server-side only. CLI thin-client work (issue E) is where any future API
    response shape gets designed.

## Constraints / Boundaries

- **Cost:** each fresh augmented digest costs ~$0.50–$0.60 at Sonnet 4.6.
  Cached digests free.
- **Latency:** ~5 minutes wall-clock per fresh augmented digest including
  video download.
- **TOS:** video-byte downloads via yt-dlp are more aggressive than today's
  transcript-only downloads. Issue A clarifies posture before frames can ship.
- **Allowlist phase:** only the repo owner sees the checkbox; no other users
  are exposed to cost, behavior changes, or schema-driven UI surprises.
- **Schema additions are additive.** No breaking changes to the CLI's existing
  `--json` output, existing API responses, or existing DB clients.

## Issue Breakdown

| # | Title | Depends on | Parallel-grabbable? |
|---|---|---|---|
| A | Research: YouTube ToS posture for video downloads | — | Yes (research, doc deliverable) |
| B | Brief schema foundations: add `transcript` + `framesStatus` + `metrics` columns | — | Yes (migration + types) |
| C | Model selection layer: pickai + discover-candidates script + migrate existing digest hardcode | — | Yes (refactor + new tooling) |
| D | Add video frames to brief generation | A, B, C landed | No (the integration step) |
| E | CLI thin-client transition | — | Yes (orthogonal, anytime) |

Three agents can simultaneously work A + B + C. A fourth can pick up E whenever.
Only D has to wait.

## Open Questions

- None at the design level. Implementation specifics (Zod schemas, pickai
  `recommend()` criteria, exact UI placement of the checkbox) get worked out
  during execution of each issue.
- **Conditional:** issue A's research output may surface mitigations the
  frames feature has to honor (rate limiting, user consent UI, etc.). Those
  feed into issue D's scope when known.

## References

- `continue-video-frames.md` — technical spike doc (4 rounds complete) including
  the reference implementation at `spikes/video-frames-pipeline/pipeline.mjs`
  and concrete A/B output at `spikes/brief-ab-test/`.
- Pickai prior art: `~/dev/niftymonkey/champ-sage/scripts/discover-candidates.ts`,
  `~/dev/niftymonkey/review-kit/scripts/discover-candidates.ts`.
- Related GitHub issues: #36 (downstream "Ask this video" chat consumer),
  #73 (Postgres cache), #77 (transcript fetcher migration — analogous
  architectural pattern).
