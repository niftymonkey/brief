import { describe, it, expect } from "vitest";
import { CLASSIFY_MODEL, DIGEST_MODEL, VISION_MODEL } from "@brief/core";
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
      expect(result.model).toBe(CLASSIFY_MODEL);
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

  it.each([
    ['"yes"', "double-quoted"],
    ["'yes'", "single-quoted"],
    ["`yes`", "backtick-quoted"],
    ["﻿yes", "BOM-prefixed"],
    ['﻿"yes"', "BOM + quoted"],
    ["  yes", "leading whitespace"],
    ["**yes**", "bold-wrapped"],
  ])("treats %s (%s) as 'yes'", async (text) => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text,
          usage: { inputTokens: 50, outputTokens: 2 },
        }),
      }),
    });

    const result = await gateway.classify(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.verdict).toBe("yes");
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

describe("createServerLlmGateway.describe", () => {
  it("returns ok with description + verbatim mode when the model emits a verbatim marker", async () => {
    const responseText = "<mode>verbatim</mode>\n[Editor showing config.ts]\n```ts\nconst x = 1;\n```";
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: responseText,
          usage: { inputTokens: 800, outputTokens: 120 },
        }),
      }),
    });

    const result = await gateway.describe(baseInput);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.mode).toBe("verbatim");
      expect(result.description).not.toMatch(/<mode>/);
      expect(result.description).toContain("const x = 1");
      expect(result.inputTokens).toBe(800);
      expect(result.outputTokens).toBe(120);
      expect(typeof result.ledgerId).toBe("string");
      expect(result.model).toBe(VISION_MODEL);
    }
  });

  it("returns mode=summary when the marker is summary", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "<mode>summary</mode>\nA dashboard showing four KPIs.",
          usage: { inputTokens: 600, outputTokens: 30 },
        }),
      }),
    });

    const result = await gateway.describe(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.mode).toBe("summary");
    expect(result.description).toBe("A dashboard showing four KPIs.");
  });

  it("falls back to mode=summary when the marker is missing", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "Just a description with no mode marker.",
          usage: { inputTokens: 600, outputTokens: 12 },
        }),
      }),
    });

    const result = await gateway.describe(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.mode).toBe("summary");
    expect(result.description).toBe("Just a description with no mode marker.");
  });

  it("records one ledger row keyed by userId with op=describe and the vision model", async () => {
    const ledger = createInMemoryUsageLedger();
    const gateway = createServerLlmGateway({
      ledger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "<mode>summary</mode>\nstub",
          usage: { inputTokens: 700, outputTokens: 50 },
        }),
      }),
    });

    const result = await gateway.describe(baseInput);
    if (result.kind !== "ok") throw new Error("expected ok");

    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.ledgerId,
      userId: "user_01",
      op: "describe",
      model: VISION_MODEL,
      inputTokens: 700,
      outputTokens: 50,
    });
  });

  it("returns kind=failed with reason=transient when the upstream LLM throws", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: {
        async generateText() {
          throw new Error("upstream is down");
        },
      },
    });

    const result = await gateway.describe(baseInput);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/upstream is down/);
    }
  });

  it("returns kind=failed with reason=transient when the ledger write fails after the LLM call", async () => {
    const brokenLedger: UsageLedger = {
      async record() {
        throw new Error("DB unavailable");
      },
      async summarize() {
        return { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
      },
    };
    const gateway = createServerLlmGateway({
      ledger: brokenLedger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "<mode>summary</mode>\nstub",
          usage: { inputTokens: 200, outputTokens: 10 },
        }),
      }),
    });

    const result = await gateway.describe(baseInput);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/ledger/i);
    }
  });

  it("allows the vision model id to be overridden via options", async () => {
    const overrideModel = "openai/gpt-5.4-nano";
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({
        text: "<mode>summary</mode>\nstub",
        usage: { inputTokens: 50, outputTokens: 10 },
      }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
      visionModel: overrideModel,
    });

    await gateway.describe(baseInput);

    expect(openrouter.calls()[0]?.model).toBe(overrideModel);
  });
});

describe("createServerLlmGateway.summarize", () => {
  const summarizeInput = {
    userId: "user_01",
    transcriptText: "the speaker walks through setting up a vector store",
    rangeSeconds: 45,
    videoTitle: "Intro to RAG",
  };

  it("returns ok with the trimmed summary text and the digest model", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({
          text: "  A quick walkthrough of wiring up a vector store.  ",
          usage: { inputTokens: 120, outputTokens: 18 },
        }),
      }),
    });

    const result = await gateway.summarize(summarizeInput);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary).toBe("A quick walkthrough of wiring up a vector store.");
      expect(result.inputTokens).toBe(120);
      expect(result.outputTokens).toBe(18);
      expect(typeof result.ledgerId).toBe("string");
      expect(result.model).toBe(DIGEST_MODEL);
    }
  });

  it("threads the collection's title and description into the prompt", async () => {
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({ text: "note", usage: { inputTokens: 10, outputTokens: 2 } }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
    });

    await gateway.summarize({
      ...summarizeInput,
      collection: {
        title: "Retrieval, end to end",
        description: "The clips I send people who ask how RAG actually works",
      },
    });

    // First-party context rides in the system message, out of reach of the
    // untrusted video title and transcript the user message carries.
    const systemMessage = openrouter.calls()[0]?.messages.find((m) => m.role === "system");
    const text = typeof systemMessage?.content === "string" ? systemMessage.content : "";
    expect(text).toContain("Retrieval, end to end");
    expect(text).toContain("The clips I send people who ask how RAG actually works");
  });

  it("omits the collection block when the caller has no collection context", async () => {
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({ text: "note", usage: { inputTokens: 10, outputTokens: 2 } }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
    });

    await gateway.summarize(summarizeInput);

    const messages = openrouter.calls()[0]?.messages ?? [];
    for (const message of messages) {
      const text = typeof message.content === "string" ? message.content : "";
      expect(text).not.toContain("Collection title:");
    }
  });

  it("sends a system+user message pair and scales max output tokens to the range", async () => {
    const openrouter = createInMemoryOpenRouterClient({
      respond: () => ({ text: "ok", usage: { inputTokens: 10, outputTokens: 2 } }),
    });
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter,
    });

    await gateway.summarize({ ...summarizeInput, rangeSeconds: 20 });
    await gateway.summarize({ ...summarizeInput, rangeSeconds: 1200 });

    const calls = openrouter.calls();
    expect(calls[0]?.messages.map((m) => m.role)).toEqual(["system", "user"]);
    // A 20s clip must be capped lower than a 20-minute excerpt.
    expect(calls[0]?.maxOutputTokens).toBeLessThan(calls[1]!.maxOutputTokens);
  });

  it("records one ledger row with op=summarize keyed by userId", async () => {
    const ledger = createInMemoryUsageLedger();
    const gateway = createServerLlmGateway({
      ledger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({ text: "summary", usage: { inputTokens: 90, outputTokens: 12 } }),
      }),
    });

    const result = await gateway.summarize(summarizeInput);
    if (result.kind !== "ok") throw new Error("expected ok");

    const rows = ledger.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.ledgerId,
      userId: "user_01",
      op: "summarize",
      model: DIGEST_MODEL,
      inputTokens: 90,
      outputTokens: 12,
    });
  });

  it("returns kind=failed with reason=transient when the upstream LLM throws", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: {
        async generateText() {
          throw new Error("upstream is down");
        },
      },
    });

    const result = await gateway.summarize(summarizeInput);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/upstream is down/);
    }
  });

  it("returns kind=failed and writes no summary when the ledger write fails", async () => {
    const brokenLedger: UsageLedger = {
      async record() {
        throw new Error("DB unavailable");
      },
      async summarize() {
        return { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0 };
      },
    };
    const gateway = createServerLlmGateway({
      ledger: brokenLedger,
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({ text: "summary", usage: { inputTokens: 90, outputTokens: 12 } }),
      }),
    });

    const result = await gateway.summarize(summarizeInput);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/ledger/i);
    }
  });

  it("returns kind=failed with bad-input when the model returns empty text", async () => {
    const gateway = createServerLlmGateway({
      ledger: createInMemoryUsageLedger(),
      openrouter: createInMemoryOpenRouterClient({
        respond: () => ({ text: "   ", usage: { inputTokens: 90, outputTokens: 0 } }),
      }),
    });

    const result = await gateway.summarize(summarizeInput);
    expect(result.kind).toBe("failed");
  });
});
