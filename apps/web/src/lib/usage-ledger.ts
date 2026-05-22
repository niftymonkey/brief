/**
 * UsageLedger records every server-mediated LLM call against a user account.
 * Token counts come from the LLM provider's response observed server-side, so
 * every row is server-attested. Cost is computed at write time using the model's
 * pricing as of that moment, so historical rows survive future price changes.
 *
 * The interface (port) is shared by two adapters: the Postgres adapter for
 * production (writes to the `usage_ledger` table; see migration 011) and the
 * in-memory adapter for tests. Callers depend on `UsageLedger`, not on either
 * adapter directly.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

import { sql } from "@vercel/postgres";
import { estimateCost } from "@brief/core";

export interface UsageCall {
  userId: string;
  op: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface UsageRow extends UsageCall {
  id: string;
  costUsd: number;
  createdAt: Date;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  calls: number;
}

export interface UsageLedger {
  record(call: UsageCall): Promise<string>;
  summarize(userId: string, since: Date): Promise<UsageSummary>;
}

export interface InMemoryUsageLedger extends UsageLedger {
  rows(): UsageRow[];
}

export interface InMemoryUsageLedgerOptions {
  clock?: () => Date;
}

export function createInMemoryUsageLedger(
  opts: InMemoryUsageLedgerOptions = {},
): InMemoryUsageLedger {
  const clock = opts.clock ?? (() => new Date());
  const store: UsageRow[] = [];

  return {
    async record(call) {
      const row: UsageRow = {
        ...call,
        id: crypto.randomUUID(),
        costUsd: estimateCost(call.model, call.inputTokens, call.outputTokens),
        createdAt: clock(),
      };
      store.push(row);
      return row.id;
    },

    async summarize(userId, since) {
      const matching = store.filter(
        (r) => r.userId === userId && r.createdAt >= since,
      );
      return matching.reduce<UsageSummary>(
        (acc, r) => ({
          inputTokens: acc.inputTokens + r.inputTokens,
          outputTokens: acc.outputTokens + r.outputTokens,
          costUsd: acc.costUsd + r.costUsd,
          calls: acc.calls + 1,
        }),
        { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 },
      );
    },

    rows() {
      return store.slice();
    },
  };
}

/**
 * Production adapter. Writes to and reads from the `usage_ledger` table
 * (migration 011). Confidence comes from end-to-end exercise through the
 * gateway route handler, not from unit tests, in line with the rest of
 * apps/web.
 */
export function createPgUsageLedger(): UsageLedger {
  return {
    async record(call) {
      const costUsd = estimateCost(
        call.model,
        call.inputTokens,
        call.outputTokens,
      );
      const result = await sql<{ id: string }>`
        INSERT INTO usage_ledger
          (user_id, op, model, input_tokens, output_tokens, cost_usd, latency_ms)
        VALUES
          (${call.userId}, ${call.op}, ${call.model},
           ${call.inputTokens}, ${call.outputTokens}, ${costUsd}, ${call.latencyMs})
        RETURNING id
      `;
      const id = result.rows[0]?.id;
      if (!id) {
        throw new Error("usage_ledger insert returned no id");
      }
      return id;
    },

    async summarize(userId, since) {
      const result = await sql<{
        input_tokens: string | null;
        output_tokens: string | null;
        cost_usd: string | null;
        calls: string;
      }>`
        SELECT
          COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
          COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
          COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
          COUNT(*)::text AS calls
        FROM usage_ledger
        WHERE user_id = ${userId}
          AND created_at >= ${since.toISOString()}
      `;
      const row = result.rows[0];
      return {
        inputTokens: Number(row?.input_tokens ?? 0),
        outputTokens: Number(row?.output_tokens ?? 0),
        costUsd: Number(row?.cost_usd ?? 0),
        calls: Number(row?.calls ?? 0),
      };
    },
  };
}
