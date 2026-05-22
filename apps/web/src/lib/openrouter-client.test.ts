import { describe, it, expect } from "vitest";
import {
  createInMemoryOpenRouterClient,
  type OpenRouterRequest,
} from "./openrouter-client";

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
