/**
 * OpenRouterClient is the server-side port for calling OpenRouter. The
 * `LlmGateway` implementation composes this port together with `UsageLedger`
 * so the gateway can swap real OpenRouter for an in-memory stub in tests.
 *
 * Two adapters live here:
 *   - `createOpenRouterClient` (production), backed by `@openrouter/ai-sdk-provider`
 *     and Vercel AI SDK's `generateText`.
 *   - `createInMemoryOpenRouterClient` (tests), returns scripted text + usage
 *     and records every call for assertion.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type ModelMessage } from "ai";

export interface OpenRouterRequest {
  model: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface OpenRouterUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface OpenRouterResult {
  text: string;
  usage: OpenRouterUsage;
}

export interface OpenRouterClient {
  generateText(req: OpenRouterRequest): Promise<OpenRouterResult>;
}

export interface InMemoryOpenRouterClient extends OpenRouterClient {
  calls(): OpenRouterRequest[];
}

export interface InMemoryOpenRouterClientOptions {
  respond: (req: OpenRouterRequest) => OpenRouterResult;
}

export function createInMemoryOpenRouterClient(
  opts: InMemoryOpenRouterClientOptions,
): InMemoryOpenRouterClient {
  const log: OpenRouterRequest[] = [];

  return {
    async generateText(req) {
      log.push({ ...req, messages: [...req.messages] });
      return opts.respond(req);
    },
    calls() {
      return log.slice();
    },
  };
}

export interface OpenRouterClientOptions {
  apiKey: string;
}

export function createOpenRouterClient(
  opts: OpenRouterClientOptions,
): OpenRouterClient {
  const openrouter = createOpenRouter({ apiKey: opts.apiKey });

  return {
    async generateText(req) {
      const result = await generateText({
        model: openrouter(req.model),
        messages: req.messages,
        maxOutputTokens: req.maxOutputTokens,
        // AI SDK v6 has no default request timeout; without one a stuck
        // upstream call would hang indefinitely. 60s is generous enough for
        // worst-case vision payloads but short enough to surface real outages.
        timeout: DEFAULT_TIMEOUT_MS,
        ...(req.signal ? { abortSignal: req.signal } : {}),
      });
      return {
        text: result.text,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      };
    },
  };
}

const DEFAULT_TIMEOUT_MS = 60_000;
