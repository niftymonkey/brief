-- Create usage_ledger table for #94: server-attested LLM call accounting.
--
-- Records every LLM call brief's server makes on behalf of an authenticated
-- caller (today: the CLI's frames pipeline and `ask` subcommand). Token counts
-- come from the LLM provider's response observed server-side, not from the
-- caller. Cost is computed at write time so historical rows survive future
-- model price changes.
--
-- One row per LLM call. Index supports per-user quota summarization
-- (Phase 5) and is the hot path for usage queries.

CREATE TABLE IF NOT EXISTS usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  op TEXT NOT NULL,                    -- 'classify' | 'describe' | 'ask' (server-controlled vocabulary)
  model TEXT NOT NULL,                 -- e.g. 'openai/gpt-5.4-nano'
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Per-user quota / summary queries: most-recent calls first.
CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_created
  ON usage_ledger (user_id, created_at DESC);
