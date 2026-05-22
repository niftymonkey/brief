-- Non-negativity CHECK constraints on usage_ledger numeric columns.
--
-- Migration 011 created the table without DB-level constraints on the numeric
-- columns. This migration adds defense-in-depth so a bug in the gateway can't
-- silently land a negative token count or cost. Skipped a CHECK on `op` because
-- the vocabulary is server-controlled and will grow, so a CHECK there would
-- force a migration per new operation.

ALTER TABLE usage_ledger
  ADD CONSTRAINT usage_ledger_input_tokens_nonneg  CHECK (input_tokens  >= 0),
  ADD CONSTRAINT usage_ledger_output_tokens_nonneg CHECK (output_tokens >= 0),
  ADD CONSTRAINT usage_ledger_cost_usd_nonneg      CHECK (cost_usd      >= 0),
  ADD CONSTRAINT usage_ledger_latency_ms_nonneg    CHECK (latency_ms    >= 0);
