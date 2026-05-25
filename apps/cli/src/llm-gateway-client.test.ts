import { describe, it, expect, vi } from "vitest";
import { CLASSIFY_MODEL, VISION_MODEL } from "@brief/core";
import { createInMemoryStore, type CredentialStore, type Tokens } from "./credentials";
import { createLlmGatewayClient, type LlmGatewayClient } from "./llm-gateway-client";
import type { Transport } from "./hosted-client";

const BASE_URL = "https://brief.test";

const sampleTokens: Tokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  userId: "user_01",
  email: "user@example.com",
};

const sampleFrame = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic header

interface StubCall {
  url: string;
  init?: RequestInit;
}

type StubPlan = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throw?: Error;
};

function createStubTransport(plans: StubPlan[]): Transport & { calls: StubCall[] } {
  const calls: StubCall[] = [];
  let i = 0;
  return {
    calls,
    async fetch(input, init) {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      const plan = plans[i++];
      if (!plan) throw new Error(`No stub plan for call #${i}`);
      if (plan.throw) throw plan.throw;
      const status = plan.status ?? 200;
      const headers = new Headers(plan.headers ?? {});
      const body = plan.body !== undefined ? JSON.stringify(plan.body) : null;
      if (plan.body !== undefined && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return new Response(body, { status, headers });
    },
  };
}

async function setup(plans: StubPlan[], tokens: Tokens | null = sampleTokens): Promise<{
  client: LlmGatewayClient;
  transport: ReturnType<typeof createStubTransport>;
  credentials: CredentialStore;
}> {
  const credentials = createInMemoryStore();
  if (tokens) await credentials.write(tokens);
  const transport = createStubTransport(plans);
  const client = createLlmGatewayClient({
    baseUrl: BASE_URL,
    credentials,
    transport,
  });
  return { client, transport, credentials };
}

const classifyOkBody = {
  verdict: "yes" as const,
  inputTokens: 200,
  outputTokens: 1,
  ledgerId: "ledger_abc",
  model: CLASSIFY_MODEL,
};

const describeOkBody = {
  description: "[Editor showing config.ts]\n```ts\nconst x = 1;\n```",
  mode: "verbatim" as const,
  inputTokens: 800,
  outputTokens: 120,
  ledgerId: "ledger_xyz",
  model: VISION_MODEL,
};

describe("LlmGatewayClient.classify", () => {
  it("returns ok with the parsed fields on 200", async () => {
    const { client } = await setup([{ status: 200, body: classifyOkBody }]);

    const result = await client.classify(sampleFrame);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.verdict).toBe("yes");
      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(1);
      expect(result.ledgerId).toBe("ledger_abc");
      expect(result.model).toBe(CLASSIFY_MODEL);
    }
  });

  it("POSTs multipart with a 'frame' field and Bearer auth to /api/cli/llm/classify", async () => {
    const { client, transport } = await setup([{ status: 200, body: classifyOkBody }]);

    await client.classify(sampleFrame);

    const call = transport.calls[0];
    expect(call?.url).toBe(`${BASE_URL}/api/cli/llm/classify`);
    expect(call?.init?.method).toBe("POST");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${sampleTokens.accessToken}`);
    const sentBody = call?.init?.body as FormData;
    expect(sentBody).toBeInstanceOf(FormData);
    const framePart = sentBody.get("frame");
    expect(framePart).toBeInstanceOf(Blob);
    if (framePart instanceof Blob) {
      expect(framePart.type).toBe("image/png");
      const bytes = new Uint8Array(await framePart.arrayBuffer());
      expect(Array.from(bytes)).toEqual(Array.from(sampleFrame));
    }
  });
});

describe("LlmGatewayClient auth handling", () => {
  it("returns kind=failed reason=auth when credentials are absent, and never calls transport", async () => {
    const { client, transport } = await setup([], null);

    const result = await client.classify(sampleFrame);

    expect(transport.calls).toHaveLength(0);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("auth");
    }
  });

  it("on 401-expired without a refreshTokens callback, surfaces auth failure with no retry", async () => {
    const { client, transport } = await setup([
      { status: 401, body: { reason: "auth", message: "expired" } },
    ]);

    const result = await client.classify(sampleFrame);

    expect(transport.calls).toHaveLength(1);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("auth");
    }
  });

  it("when refresh itself returns expired, the original 401 surfaces as auth failure (no retry)", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const transport = createStubTransport([
      { status: 401, body: { reason: "auth", message: "expired" } },
    ]);
    const refreshTokens = vi
      .fn()
      .mockResolvedValue({ kind: "expired", message: "refresh-token-also-expired" });
    const client = createLlmGatewayClient({
      baseUrl: BASE_URL,
      credentials,
      transport,
      refreshTokens,
    });

    const result = await client.classify(sampleFrame);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(transport.calls).toHaveLength(1);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("auth");
      expect(result.message).toBe("expired");
    }
  });

  it("does not attempt refresh when the 401 reason is not 'expired'", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const transport = createStubTransport([
      { status: 401, body: { reason: "auth", message: "invalid" } },
    ]);
    const refreshTokens = vi.fn();
    const client = createLlmGatewayClient({
      baseUrl: BASE_URL,
      credentials,
      transport,
      refreshTokens,
    });

    const result = await client.classify(sampleFrame);

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(transport.calls).toHaveLength(1);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("auth");
      expect(result.message).toBe("invalid");
    }
  });

  it("on 401-expired, redeems the refresh token, persists new tokens, and retries with the new bearer", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const transport = createStubTransport([
      { status: 401, body: { reason: "auth", message: "expired" } },
      { status: 200, body: classifyOkBody },
    ]);
    const refreshedTokens: Tokens = {
      ...sampleTokens,
      accessToken: "access-fresh",
      refreshToken: "refresh-new",
    };
    const refreshTokens = vi.fn().mockResolvedValue({ kind: "ok", tokens: refreshedTokens });
    const client = createLlmGatewayClient({
      baseUrl: BASE_URL,
      credentials,
      transport,
      refreshTokens,
    });

    const result = await client.classify(sampleFrame);

    expect(result.kind).toBe("ok");
    expect(refreshTokens).toHaveBeenCalledWith(sampleTokens.refreshToken);
    expect(transport.calls).toHaveLength(2);
    const retryAuth = new Headers(transport.calls[1]?.init?.headers).get("authorization");
    expect(retryAuth).toBe(`Bearer ${refreshedTokens.accessToken}`);
    const persisted = await credentials.read();
    expect(persisted?.accessToken).toBe(refreshedTokens.accessToken);
  });
});

describe("LlmGatewayClient failure translation", () => {
  it("propagates reason and message verbatim from a structured error body (non-401)", async () => {
    const { client } = await setup([
      {
        status: 429,
        body: { reason: "rate-limited", message: "quota-exhausted-retry-in-60s" },
      },
    ]);

    const result = await client.classify(sampleFrame);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("rate-limited");
      expect(result.message).toBe("quota-exhausted-retry-in-60s");
    }
  });

  it("returns kind=failed reason=transient when a 200 carries a malformed ok body", async () => {
    const { client } = await setup([
      { status: 200, body: { verdict: "yes" /* missing required fields */ } },
    ]);

    const result = await client.classify(sampleFrame);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
    }
  });

  it("returns kind=failed reason=transient when the transport throws (network error)", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const transport = createStubTransport([
      { throw: new Error("ECONNRESET") },
    ]);
    const client = createLlmGatewayClient({
      baseUrl: BASE_URL,
      credentials,
      transport,
    });

    const result = await client.classify(sampleFrame);

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.reason).toBe("transient");
      expect(result.message).toMatch(/ECONNRESET/);
    }
  });
});

describe("LlmGatewayClient.describe", () => {
  it("returns ok with description, mode, and parsed fields on 200", async () => {
    const { client, transport } = await setup([{ status: 200, body: describeOkBody }]);

    const result = await client.describe(sampleFrame);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.description).toContain("const x = 1");
      expect(result.mode).toBe("verbatim");
      expect(result.inputTokens).toBe(800);
      expect(result.outputTokens).toBe(120);
      expect(result.ledgerId).toBe("ledger_xyz");
      expect(result.model).toBe(VISION_MODEL);
    }
    expect(transport.calls[0]?.url).toBe(`${BASE_URL}/api/cli/llm/describe`);
  });
});
