import { readFileSync } from "node:fs";
import type { LlmGatewayClient } from "../llm-gateway";

export type ClassifyVerdict = "yes" | "no";

export interface ClassifyResult {
  verdict: ClassifyVerdict;
  inputTokens: number;
  outputTokens: number;
  /** Model id the LLM call actually used. Echoed up so metrics can record it. */
  model: string;
}

export type VisionMode = "verbatim" | "summary";

export interface VisionDescribeResult {
  description: string;
  /**
   * Which mode the model chose for this frame. Parsed server-side from a
   * leading `<mode>verbatim</mode>` / `<mode>summary</mode>` marker the
   * prompt instructs the model to emit. Falls back to "summary" if the
   * marker is missing or malformed.
   */
  mode: VisionMode;
  inputTokens: number;
  outputTokens: number;
  /** Model id the LLM call actually used. Echoed up so metrics can record it. */
  model: string;
}

/**
 * The orchestrator-facing interface. Implementations adapt a concrete LLM
 * backend to the throw-based contract the frames pipeline expects (success
 * shapes flow through; any non-OK becomes a thrown error the orchestrator
 * catches into its `attempted-failed` translation).
 *
 * `classifierModel` / `visionModel` start empty for adapters that learn the
 * model lazily from server responses. Metrics consumers should prefer the
 * `model` field on each call result; these properties exist only as
 * observability on the adapter itself.
 */
export interface VisionClient {
  classify(framePath: string, signal?: AbortSignal): Promise<ClassifyResult>;
  describe(framePath: string, signal?: AbortSignal): Promise<VisionDescribeResult>;
  readonly classifierModel: string;
  readonly visionModel: string;
}

/**
 * VisionClient implementation that delegates classify + describe to the
 * server-mediated `LlmGatewayClient`. Reads the frame PNG from disk into a
 * buffer, forwards bytes to the gateway, and translates the gateway's
 * discriminated `kind: "ok" | "failed"` shape into the throw-based
 * `VisionClient` contract the orchestrator expects.
 *
 * The `classifierModel` / `visionModel` readonly properties stay empty until
 * the first successful call surfaces a server-attested model id.
 */
export function createGatewayVisionClient(gateway: LlmGatewayClient): VisionClient {
  let observedClassifierModel = "";
  let observedVisionModel = "";
  return {
    get classifierModel() {
      return observedClassifierModel;
    },
    get visionModel() {
      return observedVisionModel;
    },
    async classify(framePath, signal) {
      const frame = readFileSync(framePath);
      const result = await gateway.classify(frame, signal);
      if (result.kind === "failed") {
        throw new Error(`gateway classify failed (${result.reason}): ${result.message}`);
      }
      observedClassifierModel = result.model;
      return {
        verdict: result.verdict,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
      };
    },
    async describe(framePath, signal) {
      const frame = readFileSync(framePath);
      const result = await gateway.describe(frame, signal);
      if (result.kind === "failed") {
        throw new Error(`gateway describe failed (${result.reason}): ${result.message}`);
      }
      observedVisionModel = result.model;
      return {
        description: result.description,
        mode: result.mode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
      };
    },
  };
}
