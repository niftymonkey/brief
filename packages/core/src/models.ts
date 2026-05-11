/**
 * Centralized model choices for brief's three LLM roles.
 *
 * Picks are sourced from the two-stage discovery pipeline:
 *
 *   1. `pnpm --filter @brief/core find-pre-candidates`
 *      Capability-filters the OpenRouter-reachable catalog into a
 *      pre-candidate list per role (writes scripts/pre-candidates.ts).
 *
 *   2. `pnpm --filter @brief/core discover-candidates`
 *      Scores the pre-candidate list against Artificial Analysis
 *      benchmarks. Use `--role digest|classify|vision` to run one role.
 *
 * After running, update the constants below with the chosen IDs and add
 * matching rows to PRICING. See `docs/architecture/model-selection.md`.
 *
 * Production routing: brief uses OpenRouter as the transport, so the IDs
 * below are OpenRouter's `provider/model-name` form rather than direct-API
 * IDs. Re-evaluate quarterly or when new models land.
 */

/** Pricing per 1M tokens in USD. Sourced from models.dev. */
interface ModelPricing {
  input: number;
  output: number;
}

/**
 * Used by the web app's digest pipeline (apps/web/src/lib/summarize.ts).
 * Picked from discover-candidates 2026-05-11: top quality + IF + GPQA.
 */
export const DIGEST_MODEL = "openai/gpt-5.5";

/**
 * Used by the frames module's cheap classifier (#87).
 * Picked from discover-candidates 2026-05-11: fastest competent model
 * with real pricing (qwen3.5-122b ranked higher but had n/a pricing).
 */
export const CLASSIFY_MODEL = "openai/gpt-5.4-nano";

/**
 * Used by the frames module's vision pass (#87).
 * Picked from discover-candidates 2026-05-11: same quality leader as
 * digest; 7-point quality gap over runners-up matters for verbatim
 * extraction from dense frames.
 */
export const VISION_MODEL = "openai/gpt-5.5";

export const PRICING: Record<string, ModelPricing> = {
  "openai/gpt-5.5": { input: 5.0, output: 30.0 },
  "openai/gpt-5.4-nano": { input: 0.2, output: 1.25 },
};

/**
 * Estimate USD cost for a single API call.
 * Throws if the model is not in the pricing table.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    throw new Error(
      `Invalid token count: inputTokens and outputTokens must be finite, non-negative numbers (got ${inputTokens}, ${outputTokens}).`,
    );
  }
  const price = PRICING[modelId];
  if (!price) {
    throw new Error(
      `No pricing entry for model "${modelId}". Run discover-candidates and update PRICING in packages/core/src/models.ts.`,
    );
  }
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}
