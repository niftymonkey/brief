# Model Selection Architecture

Design pass for issue #86 — the model-selection layer that centralizes Claude model choices across the digest pipeline, the (future) frame classifier, and the (future) frame vision pass. Captures the locked module boundaries, the pricing-storage strategy, and the migration step.

## Executive summary

Two files. **`packages/core/src/models.ts`** exports three string constants — `DIGEST_MODEL`, `CLASSIFY_MODEL`, `VISION_MODEL` — plus an `estimateCost(modelId, inputTokens, outputTokens)` helper backed by a small in-file pricing table. Callers import the constant they need; that is the entire runtime interface. **`packages/core/scripts/discover-candidates.ts`** is an offline CLI that fetches the models.dev catalog (optionally augmented with Artificial Analysis benchmarks), runs a `pickai` profile per role, and prints a ranked candidate list. The human runs the script, reads the output, updates the constants. Same flow as `champ-sage` and `review-kit`.

The migration: replace `claude-sonnet-4-5` at `apps/web/src/lib/summarize.ts:211` with `import { DIGEST_MODEL } from "@brief/core"`. That is the entire production code change. The frames module (#87) will consume `CLASSIFY_MODEL` and `VISION_MODEL` from day one.

## Why this design

The brief codebase has one current hardcoded model choice (`summarize.ts:211`) and three more landing with the video-frames feature. Without centralization, "upgrade to the next Sonnet" becomes a multi-file PR; without a discovery tool, the choice is one engineer's guess; without a cost helper, every metrics call sites duplicates the same `tokens * price` math against the same stale pricing constants.

This design solves all three with minimum surface. The two files own three responsibilities: declaring the chosen model per role, valuing API calls in dollars, and informing future choices through reproducible evaluation. None of those responsibilities are deep enough to need their own module.

## Module landscape

### `packages/core/src/models.ts`

| Aspect | Detail |
|---|---|
| **Interface** | Three exported string constants — `DIGEST_MODEL`, `CLASSIFY_MODEL`, `VISION_MODEL` — and one function `estimateCost(modelId: string, inputTokens: number, outputTokens: number): number`. |
| **What it hides** | The current choice of Anthropic model per role; the per-million-token pricing for each model. |
| **Leverage** | Three current call sites (one today, two when #87 lands) share one source of truth for "which model." A model upgrade is one diff in one file. Metrics consumers get cost estimates without re-implementing the math. |
| **Locality** | Model-choice decisions and pricing changes concentrate in one file. Easy to audit, easy to roll back. |
| **Dependency category** | 1 — In-process. No I/O, no port, no adapter. |
| **Test surface** | Snapshot/contract test: each exported constant is a non-empty string and exists in the pricing table. Unit test on `estimateCost` math. |

### `packages/core/scripts/discover-candidates.ts`

| Aspect | Detail |
|---|---|
| **Role** | Offline CLI. Not a runtime module. Informs the human who edits `models.ts`. |
| **Interface** | `pnpm --filter @brief/core discover-candidates [--benchmarks aa\|lmarena]`. |
| **Dependencies** | `pickai`, `models.dev` over the network, optional `ARTIFICIAL_ANALYSIS_API_KEY` for AA benchmarks (env-loaded from `apps/web/.env.local` or a local `.env`). |
| **Test surface** | None. CLI tool with stdout-only output; verified by running it. |

### Deleted candidates (recorded so they don't get re-suggested)

- *Runtime model lookup (`getModel(purpose) → string`)*. No caller needs runtime dispatch over roles. Compile-time imports are simpler and remove a layer of indirection. The discover script defines its own role enumeration inline; it does not import a runtime map from `models.ts`.
- *Per-role profile modules (`models/digest-profile.ts`, etc.)*. The three profiles in `champ-sage`'s prior art are ~30 lines each and share most logic; splitting them across files would smear what is essentially three sets of weights. Inline them in the discover script.
- *Pricing fetched from models.dev at runtime*. Adds a network dependency to every `estimateCost` call (or a cache layer that has to be invalidated). Tiny pricing table inline is easier to read, easier to test, and easier to audit. Revisit if the model count grows beyond ~10.
- *A `@brief/models` package separate from `@brief/core`*. Three constants and a helper do not justify a package boundary. Lives in `core` next to the other shared modules.

## Public interface

```typescript
// packages/core/src/models.ts

/** Used by the web app's digest pipeline (apps/web/src/lib/summarize.ts). */
export const DIGEST_MODEL = "claude-sonnet-4-6";

/** Used by the frames module's cheap classifier (packages/core/src/frames/anthropic.ts, per #87). */
export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

/** Used by the frames module's vision pass (packages/core/src/frames/anthropic.ts, per #87). */
export const VISION_MODEL = "claude-sonnet-4-6";

/**
 * Estimate cost in USD for a single API call given the model and token counts.
 * Throws if the model is not in the pricing table.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number;
```

**Invariants:**

- Constants are valid Anthropic model identifiers (the strings that go into `model:` on an SDK call).
- Pricing table includes every model in the three constants. CI catches drift via a test that asserts each exported constant has a pricing entry.
- `estimateCost` is pure; no I/O, no caching, no side effects.

**The exact values shown above are the architect's starting recommendation, anchored on the video-frames spike defaults and CLAUDE.md's "latest and most capable Claude models" guidance (Opus 4.7 / Sonnet 4.6 / Haiku 4.5). The implementer runs `discover-candidates` before committing, and adjusts if the script's recommendation differs.**

## Pricing storage

Inline pricing table, one row per model used:

```typescript
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":        { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
  // ... per Anthropic's published pricing in $/M tokens.
};
```

**Invariant:** every model exported as a role constant has a row here. A test enforces this.

**Why inline, not fetched:** three models today; even at five models the table is twenty numbers. Adding a network fetch or a build-time snapshot mechanism is more code than the data it would hide. The trade-off flips when the model count grows past ~10 or when the team adds providers beyond Anthropic; until then, inline wins on clarity and testability.

## discover-candidates shape

Modeled directly on `~/dev/niftymonkey/champ-sage/scripts/discover-candidates.ts`. Three role profiles. Each profile is a `PurposeProfile` from `pickai` with:

- A `filter` (provider whitelist, minimum context, exclude deprecated, structured-output requirement where relevant).
- A `criteria` array with weighted `ScoringCriterion` entries.
- A `stableOnly` filter to drop preview/beta builds.

**Profile starting weights (revisit during implementation against actual benchmark data):**

| Role | What matters | Suggested weights |
|---|---|---|
| **digest** | Quality + structured-output reliability + prose quality. Cost matters but not at the expense of quality. | quality=3, instruction-following=2, recency=1, cost=1. Require `structuredOutput: true` (Anthropic models need the override pattern from champ-sage). |
| **classify** | Speed and cost. Accuracy is bounded — "is there visual content?" is a binary call with a strong yes-bias. | cost=4, speed=3, quality=1. No `structuredOutput` requirement. |
| **vision** | Vision capability + quality + prose quality. Multi-modal must be true. Cost matters as a tiebreaker. | vision=required (filter), quality=3, instruction-following=2, recency=1, cost=1. |

Output format mirrors `champ-sage` — three console sections per profile (speed/balanced/quality tiers or analogous), each printing the top N with scores, GPQA, intel-index, and price.

**Anthropic structured-output override** from champ-sage applies here verbatim: `models.dev` doesn't report `structuredOutput: true` for Anthropic models, but they support it via tool-use. Override before filtering.

## Migration

One line changes in `apps/web/src/lib/summarize.ts`:

```diff
- const model = anthropic("claude-sonnet-4-5");
+ const model = anthropic(DIGEST_MODEL);
```

Plus an import:

```typescript
import { DIGEST_MODEL } from "@brief/core";
```

The frames module (#87) lands consuming `CLASSIFY_MODEL` and `VISION_MODEL` directly from the start — no separate migration. The `FramesMetrics.estimatedCostUsd` field in the #87 design is populated by calling `estimateCost(VISION_MODEL, inputTokens, outputTokens)` (and the same for `CLASSIFY_MODEL`).

## Implementation order

1. Install `pickai` as a dev dependency of `@brief/core`.
2. Build `packages/core/scripts/discover-candidates.ts` modeled on champ-sage. Add `discover-candidates` script entry to `packages/core/package.json`.
3. Run the script. Cross-check the output against CLAUDE.md's recommended latest model IDs (Opus 4.7 / Sonnet 4.6 / Haiku 4.5) and the video-frames spike's empirical defaults.
4. Write `packages/core/src/models.ts` with the chosen constants, the pricing table, and `estimateCost`.
5. Export from `packages/core/src/index.ts`.
6. Migrate `apps/web/src/lib/summarize.ts:211`.
7. Add tests for `models.ts` (constants × pricing-table consistency, `estimateCost` math).
8. `pnpm typecheck` and `pnpm test` green.
9. Commit + branch ready for review.

## Open questions for the implementer

These resolve during the build, not at design time:

- **Anthropic model IDs and pricing values.** The exact strings/numbers come from `discover-candidates` + Anthropic's pricing page. The architect's recommendations above are starting points; trust the script + the published pricing.
- **Where to place the script entry.** `packages/core/package.json`'s `scripts` field. Use `tsx` since the rest of the repo uses it; add `tsx` as a devDependency if it isn't already.
- **AA benchmark availability.** If no `ARTIFICIAL_ANALYSIS_API_KEY` is in `.env`, the script should still produce useful output (champ-sage falls back to LMArena; review-kit just runs without benchmarks). Mirror champ-sage's behavior — accept `--benchmarks lmarena` as a no-key path.
- **Sample test fixtures.** Tests need example `inputTokens`/`outputTokens` numbers to assert `estimateCost` against. Use round numbers (1M tokens) so the assertion reads cleanly.

## Cross-references

- Predecessor: `docs/video-frames-plan.md` decision #8 — pickai foundational, not deferred.
- Sibling design: `docs/architecture/video-frames.md` (#87) — consumes `CLASSIFY_MODEL`, `VISION_MODEL`, and `estimateCost` for metrics.
- Analogous prior design: `docs/architecture/transcript-cli.md` — same `@brief/core` package, similar inline-pricing-table pragmatism.
- Prior art: `~/dev/niftymonkey/champ-sage/scripts/discover-candidates.ts` (the direct model). `~/dev/niftymonkey/review-kit/scripts/discover-candidates.ts` (an OpenRouter-flavored variant, not the right shape here — brief uses Anthropic SDK directly, not OpenRouter).
