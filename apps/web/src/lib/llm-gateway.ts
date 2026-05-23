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
  type LlmFailReason,
} from "@brief/core";
import type { OpenRouterClient } from "./openrouter-client";
import type { UsageLedger } from "./usage-ledger";

// Mirrored from `packages/core/src/frames/vision.ts` for Phase 2. The CLI
// keeps its copy until Phase 4 routes the frames pipeline through this
// gateway and deletes the original. Lift the verdict-parsing logic at the
// same time so both edge cases (e.g., quoted "yes", BOM prefix) get a single
// guard rather than two divergent ones.
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
      let result;
      try {
        result = await opts.openrouter.generateText({
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
      } catch (err) {
        return {
          kind: "failed",
          reason: mapLlmError(err),
          message: errMessage(err),
        };
      }
      const latencyMs = Date.now() - start;

      // Read usage exactly once so the value written to the ledger and the
      // value returned to the caller are syntactically the same observation,
      // not a coincidence of two reads against the same field.
      const { inputTokens, outputTokens } = result.usage;
      const verdict: ClassifyVerdict = parseVerdict(result.text);

      let ledgerId: string;
      try {
        ledgerId = await opts.ledger.record({
          userId: input.userId,
          op: "classify",
          model: classifyModel,
          inputTokens,
          outputTokens,
          latencyMs,
        });
      } catch (err) {
        // The LLM call already happened (real token spend) but the audit row
        // could not be written. Returning `kind: "ok"` here would hand the
        // caller a verdict it can act on without an attribution row, which
        // breaks the invariant the gateway exists to enforce. Discard the
        // verdict; let the caller retry. The double-spend on retry is the
        // explicit cost of trustworthy attribution.
        return {
          kind: "failed",
          reason: "transient",
          message: `ledger write failed: ${errMessage(err)}`,
        };
      }

      return {
        kind: "ok",
        verdict,
        inputTokens,
        outputTokens,
        ledgerId,
      };
    },
  };
}

/**
 * Maps the classifier's text output to a yes/no verdict, defensively.
 *
 * The prompt asks the model to reply with exactly "yes" or "no", but real
 * outputs sometimes carry common LLM formatting artifacts: a leading UTF-8
 * BOM, surrounding quotes (`"yes"`, `'yes'`, `` `yes` ``), or a stray
 * markdown asterisk. Strip those before checking the prefix so a true
 * affirmative isn't silently flipped to "no" (which would skip a vision
 * call the user paid the classifier for).
 *
 * The bias remains conservative: anything that does not normalize to a
 * leading "yes" is "no".
 */
function parseVerdict(text: string): ClassifyVerdict {
  const cleaned = text
    .replace(/^﻿/, "") // strip UTF-8 BOM
    .replace(/^[\s"'`*_]+/, "") // strip leading whitespace and common wrapper punctuation
    .toLowerCase();
  return cleaned.startsWith("yes") ? "yes" : "no";
}

function mapLlmError(err: unknown): LlmFailReason {
  // OpenRouter / AI SDK errors can expose `statusCode` on `APICallError` and
  // similar. Map the known HTTP shapes; otherwise treat as transient. The
  // route handler in the next slice will refine this based on real errors
  // seen in production traffic.
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    if (code === 401) return "auth";
    if (code === 429) return "rate-limited";
    if (code === 400) return "bad-input";
  }
  return "transient";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
