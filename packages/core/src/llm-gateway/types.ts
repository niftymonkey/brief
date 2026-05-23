/**
 * Shared result types for the LLM gateway. Both CLI and server import these
 * so the wire shape and the in-process shape stay in lockstep. Phase 2 ships
 * `ClassifyResult`; Phase 3 will add `VisionDescribeResult` and `AskResult`.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

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
