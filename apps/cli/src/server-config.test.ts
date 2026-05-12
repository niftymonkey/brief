import { describe, it, expect } from "vitest";
import type { Transport } from "./hosted-client";
import { fetchServerConfig } from "./server-config";

const BASE = "https://brief.test";

interface StubCall {
  url: string;
  init?: RequestInit;
}

type StubPlan = { status?: number; body?: unknown; throw?: Error };

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
      const body = plan.body !== undefined ? JSON.stringify(plan.body) : null;
      const headers = new Headers();
      if (plan.body !== undefined) headers.set("content-type", "application/json");
      return new Response(body, { status, headers });
    },
  };
}

describe("fetchServerConfig", () => {
  it("returns ok with the parsed config on 200", async () => {
    const transport = createStubTransport([
      { status: 200, body: { workosClientId: "client_test_abc" } },
    ]);
    const result = await fetchServerConfig({ baseUrl: BASE, transport });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.config.workosClientId).toBe("client_test_abc");
    }
  });

  it("GETs /api/cli/config", async () => {
    const transport = createStubTransport([
      { status: 200, body: { workosClientId: "client_test_abc" } },
    ]);
    await fetchServerConfig({ baseUrl: BASE, transport });
    expect(transport.calls[0]?.url).toBe(`${BASE}/api/cli/config`);
    expect(transport.calls[0]?.init?.method).toBe("GET");
  });

  it("strips trailing slash on baseUrl", async () => {
    const transport = createStubTransport([
      { status: 200, body: { workosClientId: "client_test_abc" } },
    ]);
    await fetchServerConfig({ baseUrl: `${BASE}/`, transport });
    expect(transport.calls[0]?.url).toBe(`${BASE}/api/cli/config`);
  });

  it("strips multiple trailing slashes on baseUrl", async () => {
    const transport = createStubTransport([
      { status: 200, body: { workosClientId: "client_test_abc" } },
    ]);
    await fetchServerConfig({ baseUrl: `${BASE}///`, transport });
    expect(transport.calls[0]?.url).toBe(`${BASE}/api/cli/config`);
  });

  it("returns transient on network failure", async () => {
    const transport = createStubTransport([{ throw: new Error("ENOTFOUND") }]);
    const result = await fetchServerConfig({ baseUrl: BASE, transport });
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/ENOTFOUND/);
    }
  });

  it("returns transient on 5xx", async () => {
    const transport = createStubTransport([{ status: 500, body: { error: "oops" } }]);
    const result = await fetchServerConfig({ baseUrl: BASE, transport });
    expect(result.kind).toBe("transient");
  });

  it("returns transient when the response is not valid JSON", async () => {
    const transport = createStubTransport([{ status: 200 }]);
    const result = await fetchServerConfig({ baseUrl: BASE, transport });
    expect(result.kind).toBe("transient");
  });

  it("returns transient when the body shape doesn't match", async () => {
    const transport = createStubTransport([
      { status: 200, body: { something: "else" } },
    ]);
    const result = await fetchServerConfig({ baseUrl: BASE, transport });
    expect(result.kind).toBe("transient");
  });
});
