# LLM Model Selection — Operational Knowledge

This document captures everything learned while building brief's model selection layer (#86) and the production picks that came out of it. It is a companion to the design doc at [`docs/architecture/model-selection.md`](architecture/model-selection.md) — that one explains *what was built and why*; this one explains *what we found running it* and what future work should know.

Audience: future LLM conversations or contributors doing anything related to model selection, role-specific evaluation, prompt routing, or cost analysis in brief.

---

## Current locked picks

Established 2026-05-11 via the two-stage discovery pipeline, ranked against Artificial Analysis benchmark snapshot.

| Role | Model | Input | Output | Notes |
|---|---|---:|---:|---|
| Digest | `openai/gpt-5.5` | $5/M | $30/M | Won quality (60.2), IF (0.759), GPQA (0.935) outright. |
| Classify | `openai/gpt-5.4-nano` | $0.2/M | $1.25/M | Honest winner after discounting an n/a-cost qwen artifact. |
| Vision | `openai/gpt-5.5` | $5/M | $30/M | Same as digest. 7-point quality gap over runners-up justified for verbatim extraction. |

**Cost envelope per augmented brief:** ~$0.30 digest + ~$0.015 classify + ~$0.15 vision ≈ **$0.46**, inside the original $0.50/video target from the video-frames plan.

**Status of these picks:** hypotheses. They beat the runners-up on AA's composite benchmark, but AA's `ifbench` scores have known divergence from real-world brief quality (see Empirical Findings below). A future evalite eval pass is the planned tiebreaker. Until that runs, treat the picks as informed defaults, not certainties.

**Single-string swap to update:** edit the constants in `packages/core/src/models.ts`. PRICING table needs a matching row if the new model isn't already present.

---

## Two-stage discovery pipeline

Stage 1 = **objective capability filter**. Stage 2 = **scored ranking against benchmarks**. The split exists so capability and quality judgments don't get tangled in one place.

### Stage 1: `pnpm --filter @brief/core find-pre-candidates`

- Pulls the full models.dev catalog (~4,500 entries) via pickai's `fromModelsDev()`.
- Filters to OpenRouter-reachable providers only (excludes resellers like `aihubmix`, `302ai`, `vivgrid`).
- Applies role-specific *objective* capability rules:
  - **digest** — structured output + ≥100K context + ≥4K output budget.
  - **classify** — vision-capable (`attachment: true`) + ≥32K context + input cost ≤$2/M.
  - **vision** — vision-capable + ≥100K context + ≥4K output budget.
- Dedupes by `(family, releaseDate)` to collapse aggregator-routed copies of the same logical model. Prefers direct-provider records over aggregator-routed (id namespace heuristic).
- Sorts by `releaseDate` descending and caps at 25 per role.
- Writes `packages/core/scripts/pre-candidates.ts` as a hand-editable TS file (forced inclusions / exclusions live there).

### Stage 2: `pnpm --filter @brief/core discover-candidates [-- --role digest|classify|vision]`

- Loads pre-candidates from stage 1.
- Fetches Artificial Analysis benchmarks (requires `ARTIFICIAL_ANALYSIS_API_KEY`; falls back to LMArena with `--benchmarks lmarena` — but that snapshot is stale by months and misses recent model families).
- Scores each pre-candidate against the role profile (weights below).
- Prints a ranked table with quality, IF, GPQA, speed, cost columns.

### Re-running

Trigger re-discovery when any of:
- A new model family lands (announced or live).
- The current pick gets deprecated.
- Cost dynamics shift materially (price drops, new cheaper tier).
- Post-evalite findings demand revisiting.
- Quarterly cadence in absence of other triggers.

Capture date of each re-run in `models.ts` constant docstrings — the timestamp is the audit trail.

---

## Role profiles

Locked weights. Justified by what actually matters for each role. AA's available signals: `quality` (intelligence-index composite), `ifbench` (instruction following), `gpqa` (grad-level reasoning), `outputTokensPerSecond` (speed), plus pickai builtins `costEfficiency` and `recency`.

### DIGEST — structured JSON brief from a transcript
- `quality` × 3 — brief coherence is the user-facing value.
- `ifbench` × 2 — Zod schema + per-section budgets + dedup directives are IF-dependent.
- `costEfficiency` × 1 — tiebreaker; single-shot per brief at low absolute cost.

### CLASSIFY — binary "is there visual info?" on a single frame
- `costEfficiency` × 4 — ~50 calls per video; price dominates volume math.
- `outputTokensPerSecond` × 3 — 50 × 2s vs 50 × 0.5s = ~75s wall-clock; affects 5-min budget.
- `quality` × 1 — task is simple; cheapest competent model wins.

### VISION — image-to-text extraction with VERBATIM/SUMMARY mode discrimination
- `quality` × 3 — this *is* the value of the frames feature.
- `ifbench` × 2 — VERBATIM mode needs literal preservation; format adherence is heavy IF lifting.
- `gpqa` (reasoning) × 1 — picking *what's important* in dense frames benefits from deep-thinking proxy.
- `costEfficiency` × 1 — tiebreaker; ~5-10 calls/video, moderate cost.

### Criteria deliberately not used
- **`recency`** — redundant with benchmark quality data; older capable models would lose anyway. Useful only as a fallback when benchmark coverage is sparse.
- **`knowledgeFreshness`** — irrelevant. Brief generation should ground in the transcript, not the model's world knowledge.
- **`contextCapacity` / `outputCapacity`** — already enforced as stage-1 capability filters; double-counting as scoring criteria would skew.

---

## Production routing

Brief uses **OpenRouter** as the single LLM transport. Decision rationale and constraints:

### Why OpenRouter (not direct-provider SDKs)
- Cross-provider model picks become drop-in string swaps in `models.ts` — no SDK install or wiring change.
- Single API key (`OPENROUTER_API_KEY`), single billing surface, single auth path.
- Latency cost (~100-200ms per call) is sub-1% of the 5-minute augmented-brief budget. Negligible.
- Cost markup (~5%) is real but ~2.5¢/video — well below noise.
- Trade-off: less idiomatic provider-specific features (BYOK, fine-grained routing prefs) but none are needed for current call sites.

### Key location
- `OPENROUTER_API_KEY` lives in `apps/web/.env.local` only.
- The CLI thin-client (#88) will route through the web app's API, so it never holds the key directly.
- Discover-candidates script reads from `apps/web/.env.local` first, then `packages/core/.env` — but production code only reads the web app's env.

### Model ID format
- OpenRouter expects `provider/model-name` format: `openai/gpt-5.5`, not bare `gpt-5.5`.
- The constants in `models.ts` store the OpenRouter form; this is what gets passed to the SDK.
- Stage 1's `pre-candidates.ts` stores `{provider, id}` pairs separately to handle catalogs where the same id appears under multiple providers — the `id` field there is models.dev's native format, not OpenRouter's. Convert via `${provider}/${id}` if a non-OpenRouter id needs OpenRouter routing.

### Structured-output schema constraint (important)
- OpenRouter routes OpenAI-family calls through Azure's inference layer.
- **Azure's structured-output validation is stricter than Anthropic's was**: every property in the JSON schema must appear in the `required` array. Optional fields break the call.
- Practical rule: **do not use `.optional()` on Zod fields** that will be passed as `output: Output.object({ schema })` to the AI SDK. Either make them required, or use `.default(value)` (which still serializes as required).
- This is a permanent constraint of the OpenRouter→Azure routing path. New schemas added later must obey it.

---

## Empirical findings worth knowing

### Anthropic's `ifbench` scores are suspiciously low
- Claude Opus 4-7: quality 57.3, GPQA 0.914, **IF 0.586** (composite score 0.780 → rank 14 in digest).
- Claude Sonnet 4-6: quality 44.4, GPQA 0.799, **IF 0.412** (composite 0.511 → rank 18 in digest).
- For comparison, gpt-5.5: quality 60.2, GPQA 0.935, IF 0.759.
- Claude's quality and GPQA are competitive (within 5% of gpt-5.5), but the IF gap drops them from probable #2 to #14.
- The spike's A/B comparison (transcript-only vs frames-augmented brief generation, both using Sonnet 4.6) produced solid structured output. Anthropic models work well in practice for brief tasks.
- Hypothesis: AA's `ifbench` methodology may not capture how well Anthropic models perform structured output via the tool-use override pattern. Either way, this is the most important thing to **validate via evalite** — if Claude actually performs at gpt-5.5 quality on real briefs, it's a cheaper viable pick.

### `n/a` cost in benchmark data is misleading
- pickai's `costEfficiency` criterion treats `cost: undefined` as worst-case (score 0), but several catalog entries (especially Nvidia NIM previews) have `cost: 0` (free preview tier) or genuinely absent cost data.
- `cost: 0` will score artificially high on cost-efficiency. `qwen3.5-122b-a10b` ranked #1 in CLASSIFY for this reason despite no real pricing.
- When reviewing discover-candidates output, **discount any model with `cost: n/a` or `cost: $0/M`** unless you've separately verified the price. Future improvement: stage-2 could filter these out or treat them specially.

### Aggregator routing creates duplicate catalog entries
- The same logical model (e.g. DeepSeek V4 Pro) appears as separate records hosted by deepseek (direct), togetherai, nvidia (NIM), and groq. Identical `family` and `releaseDate`, different `id` and `cost`.
- Stage 1's dedup keys on `(family, releaseDate)` and prefers the direct-provider record. Without this dedup, the same model occupies 3-4 slots in the pre-candidate list and crowds out diversity.
- If a future iteration wants explicit per-aggregator entries (to compare prices on the same model), invert the dedup logic.

### LMArena fallback is stale
- The LMArena history snapshot we use lags by months. As of 2026-05-11 it was from 2025-05-22 — a full year out of date and missing Claude 4.x entirely.
- It works for sanity-checking the pipeline without an AA key but should not drive production picks.
- AA key is the right input. Don't pick models based on LMArena output.

### Latency notes from end-to-end verification
- gpt-5.5 with reasoning: ~20s for a tiny 30-second transcript (most of that is reasoning tokens before output).
- Reasoning tokens (`reasoningTokens` in the AI SDK usage response) appear in completion-token counts but are billed separately under `cost_details`.
- For digest-mode calls, gpt-5.5's reasoning is implicit (model decides whether to think); we don't currently set a max-reasoning-token budget. Worth revisiting if latency or cost matters more.

---

## Pitfalls — things not to do

- **Don't use `.optional()` on Zod fields** going through OpenRouter→Azure structured output. Azure requires `required` to include every property.
- **Don't trust a single benchmark composite** as the sole signal — especially for Anthropic models on AA's `ifbench`. Real-output evals (evalite) are the tiebreaker.
- **Don't pre-judge providers in stage 1**. The pipeline got cleaner when `HEADLINE_PROVIDERS` heuristic came out. Capability filters are objective; ranking belongs in stage 2.
- **Don't put bare model IDs in `models.ts`** — OpenRouter expects `provider/model-name` format. A bare ID will fail the call.
- **Don't load LLM API keys from `packages/core/.env`** for production code. The package is env-agnostic by design; consumer entry points (Next.js routes) load env.
- **Don't run discover-candidates without an AA key** if the output is going to inform real picks. LMArena fallback is too stale.

---

## What's next (open threads)

1. **Build evalite evals against the locked picks** — separate ticket. Validates whether gpt-5.5 actually outperforms Claude Opus 4-7 on real brief tasks (or whether AA's ifbench was misleading us). Scope: digest first, classify/vision later when #87's frames pipeline exists.
2. **`metrics` JSONB column (#85)** — will record per-brief `{model, inputTokens, outputTokens, latencyMs, costUsd}` using `estimateCost()` as the math. Once that lands, real-world cost numbers can replace estimates.
3. **Frames module (#87)** — consumes `CLASSIFY_MODEL` and `VISION_MODEL` from day one. No second model-selection round inside #87.
4. **Reasoning-token budget** — if latency or cost on digest calls becomes painful, consider explicitly capping reasoning tokens via the SDK. Currently unbounded.

---

## Cross-references

- [`docs/architecture/model-selection.md`](architecture/model-selection.md) — design doc for the model selection layer (#86).
- [`docs/architecture/video-frames.md`](architecture/video-frames.md) — design for #87; consumes `CLASSIFY_MODEL`, `VISION_MODEL`, `estimateCost`.
- [`docs/video-frames-plan.md`](video-frames-plan.md) — broader plan for the video-frames effort.
- `packages/core/src/models.ts` — current locked constants + PRICING table.
- `packages/core/scripts/find-pre-candidates.ts` — stage 1.
- `packages/core/scripts/discover-candidates.ts` — stage 2.
- `packages/core/scripts/pre-candidates.ts` — generated; hand-editable between runs.
- `apps/web/src/lib/summarize.ts` — current digest call site (OpenRouter SDK).
