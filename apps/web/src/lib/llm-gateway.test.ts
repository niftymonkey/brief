import { describe, it, expect } from "vitest";
import { CLASSIFY_MODEL } from "@brief/core";
import { createInMemoryOpenRouterClient } from "./openrouter-client";
import {
  createInMemoryUsageLedger,
  type UsageLedger,
} from "./usage-ledger";
import { createServerLlmGateway } from "./llm-gateway";

const fakeFrame = Buffer.from("not-a-real-png");
const baseInput = { userId: "user_01", frame: fakeFrame };

describe("createServerLlmGateway.classify", () => {
  it("returns ok with verdict 'yes' when the model responds 'yes'", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "yes",
          usage: { inputTokens: 200, outputTokens: 1 },
        }),
      }),
    });

    const result = await gateway.classify(baseInput);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.verdict).toBe("yes");
      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(1);
      expect(typeof result.ledgerId).toBe("string");
    }
  });

  it("treats any non-'yes' response as 'no'", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "no, this is just b-roll",
          usage: { inputTokens: 200, outputTokens: 6 },
        }),
      }),
    });

    const result = await gateway.classify(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.verdict).toBe("no");
  });

  it("records one ledger row keyed by userId with server-attested token counts", async () => {
    const ledger = createInMemoryUsageLedger();
    const gateway = createServerLlmGateway({
      ledger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "yes",
          usage: { inputTokens: 200, outputTokens: 1 },
        }),
      }),
    });

    const result = await gateway.classify(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");

    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.ledgerId,
      userId: "user_01",
      op: "classify",
      model: CLASSIFY_MODEL,
      inputTokens: 200,
      outputTokens: 1,
    });
    expect(rows[0]?.costUsd).toBeGreaterThan(0);
    expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("calls the LLM with the classify model and an image+prompt message", async () => {
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "yes",
        usage: { inputTokens: 200, outputTokens: 1 },
      }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
    });

    await gateway.classify(baseInput);

    const calls = openrouter.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(CLASSIFY_MODEL);
    expect(calls[0]?.maxOutputTokens).toBeGreaterThanOrEqual(16);

    const userMessage = calls[0]?.messages[0];
    if (
      !userMessage ||
      userMessage.role !== "user" ||
      !Array.isArray(userMessage.content)
    ) {
      throw new Error("expected a user message with array content");
    }
    const imagePart = userMessage.content.find((p) => p.type === "image");
    const textPart = userMessage.content.find((p) => p.type === "text");
    expect(imagePart).toBeDefined();
    expect(textPart).toBeDefined();
  });

  it("forwards the abort signal to the underlying LLM call", async () => {
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "yes",
        usage: { inputTokens: 10, outputTokens: 1 },
      }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
    });
    const controller = new AbortController();

    await gateway.classify({ ...baseInput, signal: controller.signal });

    expect(openrouter.calls()[0]?.signal).toBe(controller.signal);
  });

  it("returns kind 'failed' with transient when the LLM call throws", async () => {
    const ledger = createInMemoryUsageLedger();
    const gateway = createServerLlmGateway({
      ledger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => {
          throw new Error("upstream went away");
        },
      }),
    });

    const result = await gateway.classify(baseInput);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/upstream went away/);
    }
    expect(ledger.rows()).toHaveLength(0);
  });

  it("returns kind 'failed' with transient when the ledger write throws, preserving attribution discipline", async () => {
    // LLM call succeeded (token spend happened), but the ledger write failed.
    // The caller must not see an "ok" verdict it can act on without an audit
    // row, so the gateway discards the verdict and the caller retries.
    const failingLedger: UsageLedger = {
      async record() {
        throw new Error("DB unavailable");
      },
      async summarize() {
        return { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
      },
    };
    const gateway = createServerLlmGateway({
      ledger: failingLedger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "yes",
          usage: { inputTokens: 200, outputTokens: 1 },
        }),
      }),
    });

    const result = await gateway.classify(baseInput);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/ledger/i);
      expect(result.message).toMatch(/DB unavailable/);
    }
  });

  it("allows the classify model id to be overridden via options", async () => {
    // Override model must exist in PRICING (estimateCost throws otherwise).
    // Using a real model from the PRICING map that isn't the default classify model.
    const overrideModel = "openai/gpt-5.5";
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "yes",
        usage: { inputTokens: 10, outputTokens: 1 },
      }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
      classifyModel: overrideModel,
    });

    await gateway.classify(baseInput);

    expect(openrouter.calls()[0]?.model).toBe(overrideModel);
  });
});
