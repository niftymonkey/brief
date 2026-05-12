import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryStore, type CredentialStore, type Tokens } from "./credentials";
import {
  createHostedClient,
  type HostedClient,
  type Transport,
} from "./hosted-client";

const BASE_URL = "https://brief.test";

const sampleTokens: Tokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: Date.now() + 3_600_000,
  userId: "user_01",
  email: "user@example.com",
};

const validIntakeResponse = {
  schemaVersion: "2.0.0",
  briefId: "brief_abc",
  briefUrl: "https://brief.niftymonkey.dev/brief/brief_abc",
  brief: {
    summary: "Summary text",
    sections: [],
    relatedLinks: [],
    otherLinks: [],
  },
  metadata: {
    videoId: "abc123XYZAB",
    title: "Test video",
    channelTitle: "Test channel",
    channelId: "UC_abc",
    duration: "PT3M30S",
    publishedAt: "2024-01-01T00:00:00Z",
    description: "A test description",
  },
};

const validSubmission = {
  schemaVersion: "2.0.0" as const,
  videoId: "abc123XYZAB",
  metadata: validIntakeResponse.metadata,
  transcript: [
    {
      kind: "speech" as const,
      offsetSec: 0,
      durationSec: 1,
      text: "hello",
    },
  ],
  frames: { kind: "not-requested" as const },
};

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

describe("HostedClient.submit", () => {
  let credentials: CredentialStore;
  let transport: ReturnType<typeof createStubTransport>;
  let client: HostedClient;

  async function setup(plans: StubPlan[], tokens: Tokens | null = sampleTokens) {
    credentials = createInMemoryStore();
    if (tokens) await credentials.write(tokens);
    transport = createStubTransport(plans);
    client = createHostedClient({ baseUrl: BASE_URL, credentials, transport });
  }

  it("returns ok with the parsed brief on 200", async () => {
    await setup([{ status: 200, body: validIntakeResponse }]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.briefId).toBe("brief_abc");
      expect(result.briefUrl).toBe(validIntakeResponse.briefUrl);
      expect(result.brief.summary).toBe("Summary text");
    }
  });

  it("POSTs to /api/brief/intake at the configured base URL", async () => {
    await setup([{ status: 200, body: validIntakeResponse }]);
    await client.submit(validSubmission);
    expect(transport.calls[0]?.url).toBe(`${BASE_URL}/api/brief/intake`);
    expect(transport.calls[0]?.init?.method).toBe("POST");
  });

  it("sends Authorization Bearer header with the access token", async () => {
    await setup([{ status: 200, body: validIntakeResponse }]);
    await client.submit(validSubmission);
    const headers = new Headers(transport.calls[0]?.init?.headers ?? {});
    expect(headers.get("authorization")).toBe(`Bearer ${sampleTokens.accessToken}`);
  });

  it("sends Content-Type application/json with the serialized body", async () => {
    await setup([{ status: 200, body: validIntakeResponse }]);
    await client.submit(validSubmission);
    const headers = new Headers(transport.calls[0]?.init?.headers ?? {});
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(transport.calls[0]?.init?.body as string)).toEqual(validSubmission);
  });

  it("returns auth-required:missing when credentials are absent", async () => {
    await setup([], null);
    const result = await client.submit(validSubmission);
    expect(result).toEqual({ kind: "auth-required", reason: "missing" });
    expect(transport.calls).toHaveLength(0);
  });

  it("returns auth-required:expired on 401", async () => {
    await setup([{ status: 401, body: { error: "token-expired" } }]);
    const result = await client.submit(validSubmission);
    expect(result).toEqual({ kind: "auth-required", reason: "expired" });
  });

  it("returns schema-mismatch on 409 with serverAccepts", async () => {
    await setup([
      {
        status: 409,
        body: { error: "schema-mismatch", serverAccepts: ["3.0.0"] },
      },
    ]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("schema-mismatch");
    if (result.kind === "schema-mismatch") {
      expect(result.serverAccepts).toEqual(["3.0.0"]);
      expect(result.sent).toBe("2.0.0");
    }
  });

  it("returns rate-limited on 429 with Retry-After header", async () => {
    await setup([
      { status: 429, headers: { "retry-after": "120" }, body: {} },
    ]);
    const result = await client.submit(validSubmission);
    expect(result).toEqual({ kind: "rate-limited", retryAfterSeconds: 120 });
  });

  it("falls back to a default retry window when Retry-After header is missing", async () => {
    await setup([{ status: 429, body: {} }]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("returns transient on 503", async () => {
    await setup([{ status: 503, body: { error: "upstream-llm-down" } }]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("transient");
  });

  it("returns transient when fetch throws (network error)", async () => {
    await setup([{ throw: new Error("ENOTFOUND") }]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/ENOTFOUND|network/i);
    }
  });

  it("returns transient when the response body fails schema validation", async () => {
    await setup([{ status: 200, body: { foo: "bar" } }]);
    const result = await client.submit(validSubmission);
    expect(result.kind).toBe("transient");
  });
});

describe("HostedClient.whoami", () => {
  let credentials: CredentialStore;
  let transport: ReturnType<typeof createStubTransport>;
  let client: HostedClient;

  async function setup(plans: StubPlan[], tokens: Tokens | null = sampleTokens) {
    credentials = createInMemoryStore();
    if (tokens) await credentials.write(tokens);
    transport = createStubTransport(plans);
    client = createHostedClient({ baseUrl: BASE_URL, credentials, transport });
  }

  it("returns ok with email and userId on 200", async () => {
    await setup([
      {
        status: 200,
        body: { email: "user@example.com", userId: "user_01" },
      },
    ]);
    const result = await client.whoami();
    expect(result).toEqual({
      kind: "ok",
      email: "user@example.com",
      userId: "user_01",
    });
  });

  it("GETs /api/cli/whoami with Bearer token", async () => {
    await setup([
      {
        status: 200,
        body: { email: "user@example.com", userId: "user_01" },
      },
    ]);
    await client.whoami();
    expect(transport.calls[0]?.url).toBe(`${BASE_URL}/api/cli/whoami`);
    expect(transport.calls[0]?.init?.method).toBe("GET");
    const headers = new Headers(transport.calls[0]?.init?.headers ?? {});
    expect(headers.get("authorization")).toBe(`Bearer ${sampleTokens.accessToken}`);
  });

  it("returns auth-required:missing when no credentials stored", async () => {
    await setup([], null);
    const result = await client.whoami();
    expect(result).toEqual({ kind: "auth-required", reason: "missing" });
  });

  it("returns auth-required:expired on 401", async () => {
    await setup([{ status: 401, body: {} }]);
    const result = await client.whoami();
    expect(result).toEqual({ kind: "auth-required", reason: "expired" });
  });
});

describe("HostedClient.logout", () => {
  let credentials: CredentialStore;
  let transport: ReturnType<typeof createStubTransport>;
  let client: HostedClient;

  async function setup(plans: StubPlan[], tokens: Tokens | null = sampleTokens) {
    credentials = createInMemoryStore();
    if (tokens) await credentials.write(tokens);
    transport = createStubTransport(plans);
    client = createHostedClient({ baseUrl: BASE_URL, credentials, transport });
  }

  it("returns ok on 204 from server", async () => {
    await setup([{ status: 204 }]);
    const result = await client.logout();
    expect(result).toEqual({ kind: "ok" });
  });

  it("POSTs to /api/cli/logout with Bearer", async () => {
    await setup([{ status: 204 }]);
    await client.logout();
    expect(transport.calls[0]?.url).toBe(`${BASE_URL}/api/cli/logout`);
    expect(transport.calls[0]?.init?.method).toBe("POST");
  });

  it("returns ok (no-op) when no credentials stored", async () => {
    await setup([], null);
    const result = await client.logout();
    expect(result).toEqual({ kind: "ok" });
    expect(transport.calls).toHaveLength(0);
  });

  it("returns transient when server unreachable, so local clear still proceeds", async () => {
    await setup([{ throw: new Error("ECONNREFUSED") }]);
    const result = await client.logout();
    expect(result.kind).toBe("transient");
  });
});
