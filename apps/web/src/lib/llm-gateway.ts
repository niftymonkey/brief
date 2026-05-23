/**
 * Server-side LLM gateway. Composes `UsageLedger` and `OpenRouterClient` into
 * a single deep module: every LLM call goes through here, server-attested
 * token counts get written to the ledger inline, and the caller receives a
 * parsed domain result with a `ledgerId` for correlation.
 *
 * Phase 2 ships `classify` only. Phase 3 will add `describe` and `ask`. The
 * CLI consumes this gateway over HTTP via the route handlers under
 * `/api/cli/llm/<op>`; tests compose it in-process with in-memory adapters.
 *
 * Prompts live here, not in the CLI. Iterating on prompt quality no longer
 * requires a CLI release.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

import {
  CLASSIFY_MODEL,
  type ClassifyResult,
  type ClassifyVerdict,
} from "@brief/core";
import type { OpenRouterClient } from "./openrouter-client";
import type { UsageLedger } from "./usage-ledger";

const CLASSIFIER_PROMPT = `Look at this frame from a YouTube video. Decide whether it carries visual information beyond what spoken narration would convey:

- Reply "yes" if the frame contains: text, code, slides, diagrams, charts, app/web UI, terminal output, dashboards, screenshots, file trees, IDE windows, screenshots of social posts, or any other on-screen content where the visible elements convey information that spoken words alone would miss.
- Reply "no" if the frame is just the speaker on camera, generic B-roll (outdoor, hands typing without visible screen content, etc.), title cards with just a name, or stock footage. Only what the speaker is saying matters in these.

When uncertain, lean "yes". Reply with exactly one word: yes or no.`;

// 16 is the floor enforced by some OpenRouter-routed providers (e.g.
// Azure-hosted GPT-5 nano). Anthropic-direct accepts 5; routing through
// OpenRouter forces the higher minimum.
const CLASSIFIER_MAX_OUTPUT_TOKENS = 16;

export interface ClassifyInput {
  userId: string;
  frame: Buffer;
  signal?: AbortSignal;
}

export interface ServerLlmGateway {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
}

export interface ServerLlmGatewayOptions {
  ledger: UsageLedger;
  openrouter: OpenRouterClient;
  classifyModel?: string;
}

export function createServerLlmGateway(
  opts: ServerLlmGatewayOptions,
): ServerLlmGateway {
  const classifyModel = opts.classifyModel ?? CLASSIFY_MODEL;

  return {
    async classify(input) {
      const start = Date.now();
      const result = await opts.openrouter.generateText({
        model: classifyModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: input.frame, mediaType: "image/png" },
              { type: "text", text: CLASSIFIER_PROMPT },
            ],
          },
        ],
        maxOutputTokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const latencyMs = Date.now() - start;

      const verdict: ClassifyVerdict = result.text.trim().toLowerCase().startsWith("yes")
        ? "yes"
        : "no";

      const ledgerId = await opts.ledger.record({
        userId: input.userId,
        op: "classify",
        model: classifyModel,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs,
      });

      return {
        kind: "ok",
        verdict,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        ledgerId,
      };
    },
  };
}
