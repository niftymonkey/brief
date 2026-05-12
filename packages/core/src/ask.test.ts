import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { askVideo, ASK_SYSTEM_PROMPT } from "./ask";

/**
 * Builds a MockLanguageModelV3 that records the prompts it was called with and
 * returns a canned response. The shape matches the v3 model-spec contract used
 * by the AI SDK's testing helpers.
 */
function mockOkModel(text: string): {
  model: MockLanguageModelV3;
  calls: { system?: string; userPromptText?: string }[];
} {
  const calls: { system?: string; userPromptText?: string }[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options: unknown) => {
      // `options.prompt` is the v3 model-message format; extract the system
      // message and the user-message text so tests can assert on them.
      const messages = (options as { prompt?: Array<{ role: string; content: unknown }> }).prompt ?? [];
      const sys = messages.find((m) => m.role === "system");
      const usr = messages.find((m) => m.role === "user");
      const userText = Array.isArray(usr?.content)
        ? (usr!.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("")
        : typeof usr?.content === "string"
          ? (usr.content as string)
          : "";
      const sysText = typeof sys?.content === "string" ? (sys.content as string) : "";
      calls.push({ system: sysText, userPromptText: userText });
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 150, noCache: 150, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 42, text: 42, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

function mockThrowingModel(err: Error): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      throw err;
    },
  });
}

describe("ASK_SYSTEM_PROMPT", () => {
  it("instructs the model to treat [VISUAL] markers as first-class video content", () => {
    expect(ASK_SYSTEM_PROMPT).toMatch(/\[VISUAL\]/);
    expect(ASK_SYSTEM_PROMPT).toMatch(/first-class video content/i);
  });

  it("instructs the model to cite [MM:SS] timestamps when relevant", () => {
    expect(ASK_SYSTEM_PROMPT).toMatch(/\[MM:SS\]/);
  });

  it("tells the model to admit when the transcript can't answer the question", () => {
    expect(ASK_SYSTEM_PROMPT).toMatch(/can't be answered|do not guess/i);
  });
});

describe("askVideo", () => {
  const sampleTranscript = "[0:00-0:05] Welcome to the show\n\n[0:30] [VISUAL] Pricing: $19/mo\n";

  it("returns kind=ok with the model's answer trimmed and metrics populated", async () => {
    const { model } = mockOkModel("  The pricing is $19/mo.  ");
    const result = await askVideo({
      transcript: sampleTranscript,
      question: "What's the pricing?",
      openRouterApiKey: "unused-when-_model-is-supplied",
      _model: model,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.answer).toBe("The pricing is $19/mo.");
      expect(result.metrics.inputTokens).toBe(150);
      expect(result.metrics.outputTokens).toBe(42);
      expect(result.metrics.model).toBe("openai/gpt-5.5"); // DIGEST_MODEL default
      expect(result.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("forwards the transcript text into the user prompt verbatim", async () => {
    const { model, calls } = mockOkModel("answer");
    await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      _model: model,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].userPromptText).toContain(sampleTranscript);
    expect(calls[0].userPromptText).toContain("Question: anything");
  });

  it("uses ASK_SYSTEM_PROMPT as the system message so [VISUAL] guidance reaches the model", async () => {
    const { model, calls } = mockOkModel("answer");
    await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      _model: model,
    });
    expect(calls[0].system).toBe(ASK_SYSTEM_PROMPT);
  });

  it("uses the explicit model override when supplied for metrics labeling", async () => {
    const { model } = mockOkModel("answer");
    const result = await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      model: "openai/some-other-model",
      _model: model,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.metrics.model).toBe("openai/some-other-model");
    }
  });

  it("maps a 401-flavored error to kind=failed reason=auth", async () => {
    const result = await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      _model: mockThrowingModel(new Error("401 Invalid API key")),
    });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("auth");
      expect(result.message).toMatch(/401/);
    }
  });

  it("maps a 429/rate-limit error to kind=failed reason=rate-limited", async () => {
    const result = await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      _model: mockThrowingModel(new Error("429 rate limit exceeded")),
    });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("rate-limited");
    }
  });

  it("maps an unknown error to kind=failed reason=transient", async () => {
    const result = await askVideo({
      transcript: sampleTranscript,
      question: "anything",
      openRouterApiKey: "unused",
      _model: mockThrowingModel(new Error("ECONNREFUSED")),
    });
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
    }
  });
});
