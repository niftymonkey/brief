/**
 * Stage 1 of the model-selection pipeline: capability filtering.
 *
 * Identifies the set of OpenRouter-reachable models that *can* do each
 * role (per objective capability rules), sorted by recency. Output is
 * the input to `discover-candidates`, which scores them against real
 * benchmark data and produces the ranked short-list.
 *
 * Stage 1 does NOT decide which provider or family deserves a slot —
 * that's a comparison stage 2 owns. The cap exists only to keep the
 * file scannable; everything above the cap is recent and capable.
 *
 * Usage:
 *   pnpm --filter @brief/core find-pre-candidates
 *
 * Roles & capability rules (objective only):
 *   - digest:   structured-output-capable + long context + decent output budget
 *   - classify: vision-capable + cheap tier (≤ $2/M input)
 *   - vision:   vision-capable + long context + decent output budget
 *
 * Re-run when new models land or existing ones get deprecated.
 *
 * See `docs/architecture/model-selection.md` for the design pass.
 */

import { dirname, resolve } from "path";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  fromModelsDev,
  applyFilter,
  matchesModel,
  OPENROUTER_PROVIDERS,
  type Model,
  type ModelFilter,
} from "pickai";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Fetch + normalize ---

console.log("Fetching models from models.dev...");
const rawModels = await fromModelsDev();

const STRUCTURED_OUTPUT_OVERRIDES = ["anthropic"];
const allModels = rawModels.map((m) =>
  STRUCTURED_OUTPUT_OVERRIDES.includes(m.provider) && !m.structuredOutput
    ? { ...m, structuredOutput: true }
    : m,
);
console.log(`  ${allModels.length} models loaded\n`);

// --- Selection helpers ---

const stableOnly = (m: Model) => {
  if (m.status === "beta") return false;
  const name = m.name.toLowerCase();
  if (name.includes("preview")) return false;
  return true;
};

// Cap exists only to keep the generated file scannable. Anything past
// this is older than the cutoff and unlikely to beat a newer same-family
// option in stage 2 scoring.
const ROLE_CAP = 25;

const byRecency = (a: Model, b: Model) =>
  (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");

// --- Capability filters (objective, no provider judgment) ---

const digestFilter: ModelFilter = {
  providers: [...OPENROUTER_PROVIDERS],
  structuredOutput: true,
  minContext: 100_000,
  minOutput: 4_000,
  excludeDeprecated: true,
};

// classify: per-frame vision call with a short response. Cost-sensitive,
// so cap input pricing — this is an objective rule, not a coverage choice.
const classifyFilter: ModelFilter = {
  providers: [...OPENROUTER_PROVIDERS],
  attachment: true,
  minContext: 32_000,
  maxCostInput: 2,
  excludeDeprecated: true,
};

const visionFilter: ModelFilter = {
  providers: [...OPENROUTER_PROVIDERS],
  attachment: true,
  minContext: 100_000,
  minOutput: 4_000,
  excludeDeprecated: true,
};

// --- Build pre-candidates ---

// Aggregators republish the same logical model under multiple provider
// records (e.g. deepseek-v4-pro is reachable as `deepseek/deepseek-v4-pro`
// and `togetherai/deepseek-ai/DeepSeek-V4-Pro`). pickai's `matchesModel`
// normalizes namespace prefixes, date suffixes, dots/hyphens, and case
// when comparing two IDs — exactly the cross-format equivalence we need.
// We pair that with `releaseDate` so different generations sharing a family
// name (e.g. claude-sonnet-4-5 vs claude-sonnet-4-6) don't collapse.
//
// Preference within a group:
//   1. Direct-provider record (id without an aggregator namespace prefix).
//   2. Cheapest known input price (treats $0 as suspect; falls behind real pricing).
function dedupeByRelease(models: Model[]): Model[] {
  const isDirect = (m: Model) =>
    !m.id.includes("/") || m.id.startsWith(`${m.provider}/`);
  const cost = (m: Model) =>
    m.cost?.input && m.cost.input > 0 ? m.cost.input : Infinity;

  const groups: Model[][] = [];
  for (const m of models) {
    const date = m.releaseDate ?? "";
    const group = groups.find(
      (g) => (g[0].releaseDate ?? "") === date && matchesModel(g[0].id, m.id),
    );
    if (group) {
      group.push(m);
    } else {
      groups.push([m]);
    }
  }

  return groups.map((group) => {
    const direct = group.filter(isDirect);
    const pool = direct.length > 0 ? direct : group;
    return pool.sort((a, b) => cost(a) - cost(b))[0];
  });
}

function preCandidatesFor(filter: ModelFilter): Model[] {
  const eligible = applyFilter(allModels, filter).filter(stableOnly);
  return dedupeByRelease(eligible).sort(byRecency).slice(0, ROLE_CAP);
}

const roles = {
  digest: preCandidatesFor(digestFilter),
  classify: preCandidatesFor(classifyFilter),
  vision: preCandidatesFor(visionFilter),
};

// --- Print preview ---

for (const [role, models] of Object.entries(roles)) {
  console.log(`--- ${role.toUpperCase()} (${models.length}) ---`);
  for (const m of models) {
    const cost = m.cost?.input !== undefined ? `$${m.cost.input}/M` : "n/a";
    const family = m.family ?? "?";
    const date = m.releaseDate ?? "?";
    console.log(
      `  ${date.padEnd(10)} | ${m.id.padEnd(40)} | ${m.provider.padEnd(11)} | ${family.padEnd(18)} | ${cost}`,
    );
  }
  console.log();
}

// --- Write pre-candidates.ts ---

const preCandidates = {
  digest: roles.digest.map((m) => ({ provider: m.provider, id: m.id })),
  classify: roles.classify.map((m) => ({ provider: m.provider, id: m.id })),
  vision: roles.vision.map((m) => ({ provider: m.provider, id: m.id })),
};

const outPath = resolve(__dirname, "pre-candidates.ts");
const content = `// Generated by \`pnpm --filter @brief/core find-pre-candidates\`.
// Hand-edit between runs to add or remove specific candidates.
// Generated: ${new Date().toISOString()}

export type Role = "digest" | "classify" | "vision";
export interface Candidate {
  provider: string;
  id: string;
}

export const preCandidates: Record<Role, Candidate[]> = ${JSON.stringify(preCandidates, null, 2)};
`;

writeFileSync(outPath, content, "utf8");
console.log(`Wrote ${outPath}`);
console.log(
  `Next: pnpm --filter @brief/core discover-candidates  (use --role <name> to focus)\n`,
);
