/**
 * Stage 2 of the model-selection pipeline: scoring + ranking.
 *
 * Loads the pre-candidate lists from `pre-candidates.ts` (produced by
 * `find-pre-candidates`), fetches benchmark data from Artificial Analysis
 * (or LMArena as fallback), and prints a ranked short-list per role.
 *
 * Usage:
 *   pnpm --filter @brief/core discover-candidates
 *   pnpm --filter @brief/core discover-candidates -- --role digest
 *   pnpm --filter @brief/core discover-candidates -- --benchmarks lmarena
 *
 * Env: requires ARTIFICIAL_ANALYSIS_API_KEY in apps/web/.env.local (or a
 * local .env) for AA benchmarks. Pass --benchmarks lmarena to skip.
 *
 * Profile weights per role:
 *   - digest:   quality(3) + instruction-following(2) + recency(1) + cost(1)
 *   - classify: cost(4) + speed(3) + quality(1)
 *   - vision:   quality(3) + instruction-following(2) + reasoning(1) + recency(1) + cost(1)
 *
 * After running, update `packages/core/src/models.ts` with the chosen IDs
 * and add a matching row to PRICING.
 */

import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  fromModelsDev,
  recommend,
  minMaxCriterion,
  matchesModel,
  costEfficiency,
  recency,
  type PurposeProfile,
  type ScoringCriterion,
  type Model,
  type ScoredModel,
} from "pickai";

import { preCandidates, type Candidate, type Role } from "./pre-candidates";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Env: try apps/web/.env.local first (where brief stores secrets), then a local .env.
config({ path: resolve(__dirname, "../../../apps/web/.env.local") });
config({ path: resolve(__dirname, "../.env") });

// --- CLI args ---

const args = process.argv.slice(2).filter((a) => a !== "--");
const VALID_ROLES = ["digest", "classify", "vision"] as const;

function takeArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const roleArg = takeArg("--role");
if (roleArg && !VALID_ROLES.includes(roleArg as Role)) {
  console.error(
    `Invalid --role: "${roleArg}". Must be one of: ${VALID_ROLES.join(", ")}`,
  );
  process.exit(2);
}
const rolesToRun: Role[] = roleArg ? [roleArg as Role] : [...VALID_ROLES];

const benchmarkSource = takeArg("--benchmarks") ?? "aa";

// --- Fetch models ---

console.log("Fetching models from models.dev...");
const rawModels = await fromModelsDev();
const STRUCTURED_OUTPUT_OVERRIDES = ["anthropic"];
const allModels = rawModels.map((m) =>
  STRUCTURED_OUTPUT_OVERRIDES.includes(m.provider) && !m.structuredOutput
    ? { ...m, structuredOutput: true }
    : m,
);
console.log(`  ${allModels.length} models loaded\n`);

// --- Benchmark data ---

interface BenchmarkEntry {
  modelId: string;
  quality: number;
  ifScore?: number;
  gpqa?: number;
  outputTokensPerSecond?: number;
  timeToFirstToken?: number;
}

async function fetchJsonOrThrow<T>(
  url: string,
  init: RequestInit | undefined,
  label: string,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${label} request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
    );
  }
  return response.json() as Promise<T>;
}

let benchmarks: BenchmarkEntry[];
let benchmarkLabel: string;

if (benchmarkSource === "lmarena") {
  console.log("Fetching LMArena benchmark scores...");
  const scoresData = await fetchJsonOrThrow<
    Record<string, { text: { overall: Record<string, number> } }>
  >(
    "https://raw.githubusercontent.com/nakasyou/lmarena-history/main/output/scores.json",
    undefined,
    "LMArena benchmark",
  );
  const dates = Object.keys(scoresData).sort();
  const latestScores = scoresData[dates[dates.length - 1]].text.overall;
  benchmarks = Object.entries(latestScores).map(([modelId, score]) => ({
    modelId,
    quality: score,
  }));
  benchmarkLabel = `LMArena (${dates[dates.length - 1]})`;
  console.log(`  ${benchmarks.length} models with scores\n`);
} else {
  const aaKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!aaKey) {
    console.error(
      "ARTIFICIAL_ANALYSIS_API_KEY not found.\n" +
        "Get one at https://artificialanalysis.ai and add it to apps/web/.env.local.\n" +
        "Or run with --benchmarks lmarena to skip.",
    );
    process.exit(1);
  }
  console.log("Fetching Artificial Analysis benchmark scores...");
  const aaData = await fetchJsonOrThrow<{
    data: Array<Record<string, unknown>>;
  }>(
    "https://artificialanalysis.ai/api/v2/data/llms/models",
    { headers: { "x-api-key": aaKey } },
    "Artificial Analysis benchmark",
  );
  benchmarks = aaData.data
    .filter((m) => m.evaluations)
    .map((m) => {
      const evals = m.evaluations as Record<string, number | null>;
      return {
        modelId: m.slug as string,
        quality: evals.artificial_analysis_intelligence_index ?? 0,
        ifScore: evals.ifbench ?? undefined,
        gpqa: evals.gpqa ?? undefined,
        outputTokensPerSecond:
          (m.median_output_tokens_per_second as number) ?? undefined,
        timeToFirstToken:
          (m.median_time_to_first_token_seconds as number) ?? undefined,
      };
    });
  benchmarkLabel = `Artificial Analysis (${benchmarks.length} models)`;
  console.log(`  ${benchmarks.length} models with scores\n`);
}

// --- Scoring criteria backed by benchmarks ---

const lookupBenchmark = (model: Model) =>
  benchmarks.find((b) => matchesModel(b.modelId, model.id));

const qualityScore: ScoringCriterion = minMaxCriterion(
  (model) => lookupBenchmark(model)?.quality,
);
const hasIFScores = benchmarks.some((b) => b.ifScore !== undefined);
const instructionFollowing: ScoringCriterion = minMaxCriterion(
  (model) => lookupBenchmark(model)?.ifScore,
);
const hasGPQA = benchmarks.some((b) => b.gpqa !== undefined);
const reasoningScore: ScoringCriterion = minMaxCriterion(
  (model) => lookupBenchmark(model)?.gpqa,
);
const hasSpeed = benchmarks.some((b) => b.outputTokensPerSecond !== undefined);
const speedScore: ScoringCriterion = minMaxCriterion(
  (model) => lookupBenchmark(model)?.outputTokensPerSecond,
);

// --- Per-role scoring profiles ---

const profiles: Record<Role, PurposeProfile> = {
  digest: {
    criteria: [
      { criterion: qualityScore, weight: 3 },
      ...(hasIFScores ? [{ criterion: instructionFollowing, weight: 2 }] : []),
      { criterion: recency, weight: 1 },
      { criterion: costEfficiency, weight: 1 },
    ],
  },
  classify: {
    criteria: [
      { criterion: costEfficiency, weight: 4 },
      ...(hasSpeed ? [{ criterion: speedScore, weight: 3 }] : []),
      { criterion: qualityScore, weight: 1 },
    ],
  },
  vision: {
    criteria: [
      { criterion: qualityScore, weight: 3 },
      ...(hasIFScores ? [{ criterion: instructionFollowing, weight: 2 }] : []),
      ...(hasGPQA ? [{ criterion: reasoningScore, weight: 1 }] : []),
      { criterion: recency, weight: 1 },
      { criterion: costEfficiency, weight: 1 },
    ],
  },
};

// --- Run ---

console.log(`=== BRIEF DISCOVER-CANDIDATES [${benchmarkLabel}] ===\n`);

for (const role of rolesToRun) {
  scoreRole(role);
}

console.log(
  "Update packages/core/src/models.ts with the chosen IDs and add a row to PRICING.\n",
);

// --- Helpers ---

function scoreRole(role: Role) {
  const pairs = preCandidates[role];
  if (pairs.length === 0) {
    console.log(`--- ${role.toUpperCase()}: (no pre-candidates) ---\n`);
    return;
  }
  const matches = (m: Model, c: Candidate) =>
    m.provider === c.provider && m.id === c.id;
  const candidates = allModels.filter((m) => pairs.some((c) => matches(m, c)));
  if (candidates.length < pairs.length) {
    const missing = pairs.filter(
      (c) => !allModels.some((m) => matches(m, c)),
    );
    console.warn(
      `  warning: ${missing.length} pre-candidate(s) not found in catalog: ${missing
        .map((c) => `${c.provider}/${c.id}`)
        .join(", ")}`,
    );
  }
  console.log(`--- ${role.toUpperCase()} (${candidates.length} candidates) ---\n`);
  const results = recommend(candidates, profiles[role], {
    limit: candidates.length,
  });
  printResults(results);
  console.log();
}

function fmtSpeed(tps: number | undefined): string {
  if (tps === undefined) return "n/a";
  return `${Math.round(tps)} tok/s`;
}

function printResults(results: ScoredModel<Model>[]) {
  for (const m of results) {
    const bm = lookupBenchmark(m);
    const cost = m.cost?.input ? `$${m.cost.input}/M` : "n/a";
    console.log(
      `  ${m.score.toFixed(3)} | ${m.id.padEnd(34)} | ${m.provider.padEnd(10)} | quality: ${String(bm?.quality ?? "n/a").padStart(5)} | IF: ${String(bm?.ifScore ?? "n/a").padStart(5)} | GPQA: ${String(bm?.gpqa ?? "n/a").padStart(5)} | speed: ${fmtSpeed(bm?.outputTokensPerSecond).padStart(10)} | cost: ${cost.padStart(8)}`,
    );
  }
}
