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

export type LlmFailReason =
  | "auth"
  | "quota-exceeded"
  | "rate-limited"
  | "transient"
  | "bad-input";

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

export const ClassifyOkBodySchema = z.object({
  verdict: z.enum(["yes", "no"]),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  ledgerId: z.string().min(1),
});
export type ClassifyOkBody = z.infer<typeof ClassifyOkBodySchema>;

export const LlmErrorBodySchema = z.object({
  reason: z.enum([
    "auth",
    "quota-exceeded",
    "rate-limited",
    "transient",
    "bad-input",
  ]),
  message: z.string(),
});
export type LlmErrorBody = z.infer<typeof LlmErrorBodySchema>;
