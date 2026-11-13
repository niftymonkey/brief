import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createServerLlmGateway } from "./llm-gateway";
import {
  createInMemoryOpenRouterClient,
  createOpenRouterClient,
  type OpenRouterRequest,
} from "./openrouter-client";
import { createInMemoryUsageLedger } from "./usage-ledger";

const openRouterModel = vi.hoisted(() => {
  const holder: { current: MockLanguageModelV3 | null } = { current: null };
  return holder;
});

// OpenRouter is the outside system; the AI SDK in front of it runs for real.
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => () => openRouterModel.current,
}));

/** A model that finishes normally with `text` and reports the given token counts. */
const modelReplying = (text: string, inputTokens: number, outputTokens: number): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
      },
      warnings: [],
    },
  });

describe("OpenRouterClient (production adapter)", () => {
  it("records the spend of a structured reply that is not the asked-for shape, then rejects it as bad input", async () => {
    openRouterModel.current = modelReplying("Here is a title: Vector stores", 812, 9);
    const ledger = createInMemoryUsageLedger();
    const gateway = createServerLlmGateway({
      ledger,
      openrouter: createOpenRouterClient({ apiKey: "test-key" }),
    });

    const result = await gateway.writeClipWords({
      userId: "user_01",
      wants: "title",
      transcriptText: "today we wire up a vector store",
      rangeSeconds: 30,
    });

    expect(result).toMatchObject({ kind: "failed", reason: "bad-input" });
    expect(ledger.rows()).toMatchObject([{ op: "clip-words", inputTokens: 812, outputTokens: 9 }]);
  });
});

const baseReq: OpenRouterRequest = {
  model: "openai/gpt-5.4-nano",
  messages: [{ role: "user", content: "is this a frame? respond yes or no" }],
  maxOutputTokens: 16,
};

describe("OpenRouterClient (in-memory adapter)", () => {
  it("returns the scripted response for a request", async () => {
    const client = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "yes",
        usage: { inputTokens: 100, outputTokens: 1 },
      }),
    });
    const result = await client.generateText(baseReq);
    expect(result.text).toBe("yes");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 1 });
  });

  it("records each call for later inspection", async () => {
    const client = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "ok",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    const req1 = { ...baseReq, model: "m1" };
    const req2 = { ...baseReq, model: "m2" };
    await client.generateText(req1);
    await client.generateText(req2);
    expect(client.calls()).toEqual([req1, req2]);
  });

  it("supports per-call scripted responses", async () => {
    const responses = [
      { text: "first", usage: { inputTokens: 10, outputTokens: 1 } },
      { text: "second", usage: { inputTokens: 20, outputTokens: 2 } },
    ];
    let i = 0;
    const client = createInMemoryOpenRouterClient({
      respond: () => responses[i++]!,
    });
    const a = await client.generateText(baseReq);
    const b = await client.generateText(baseReq);
    expect(a.text).toBe("first");
    expect(b.text).toBe("second");
  });

  it("passes the request to the respond function for context-aware stubbing", async () => {
    const client = createInMemoryOpenRouterClient({
      respond: (req) => ({
        text: `model=${req.model}`,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    const result = await client.generateText({ ...baseReq, model: "openai/foo" });
    expect(result.text).toBe("model=openai/foo");
  });
});
