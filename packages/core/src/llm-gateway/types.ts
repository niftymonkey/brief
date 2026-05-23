/**
 * Shared types and wire schemas for the LLM gateway. Both CLI and server
 * import these so the in-process result shape and the HTTP body shape stay
 * in lockstep. Phase 2 ships `ClassifyResult`; Phase 3 will add
 * `VisionDescribeResult` and `AskResult`.
 *
 * Wire convention: 200 responses carry the success body shape (no `kind`
 * field, since the status code already says "ok"). Non-200 responses carry
 * `{ reason, message }` and the CLI HTTP adapter is responsible for
 * lifting the (status, body) pair back into a `kind: "failed"` variant.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

import { z } from "zod";

// Single source of truth for the wire-level failure vocabulary. The Zod
// enum below uses this list directly so the schema and the `LlmFailReason`
// type cannot drift.
export const LLM_FAIL_REASONS = [
  "auth",
  "quota-exceeded",
  "rate-limited",
  "transient",
  "bad-input",
] as const;

export type LlmFailReason = (typeof LLM_FAIL_REASONS)[number];

export interface LlmCallSucceeded {
  ledgerId: string;
  inputTokens: number;
  outputTokens: number;
}

export type ClassifyVerdict = "yes" | "no";

export type ClassifyResult =
  | (LlmCallSucceeded & { kind: "ok"; verdict: ClassifyVerdict })
  | { kind: "failed"; reason: LlmFailReason; message: string };

// Wire schemas: the shapes that travel over HTTP between CLI and server.
// Deliberately non-strict (Zod's default for `z.object`): a server emitting
// additional fields should not break older CLIs. CLI-side parsing extracts
// known fields and ignores the rest.

export const ClassifyOkBodySchema = z.object({
  verdict: z.enum(["yes", "no"]),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  ledgerId: z.string().min(1),
});
export type ClassifyOkBody = z.infer<typeof ClassifyOkBodySchema>;

export const LlmErrorBodySchema = z.object({
  reason: z.enum(LLM_FAIL_REASONS),
  message: z.string(),
});
export type LlmErrorBody = z.infer<typeof LlmErrorBodySchema>;
