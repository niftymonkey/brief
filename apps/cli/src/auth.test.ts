import { describe, it, expect } from "vitest";
import { createAuthFlow } from "./auth";
import type { Transport } from "./hosted-client";

const WORKOS_URL = "https://api.test.workos.com";
const CLIENT_ID = "client_test_abc";

const sampleDeviceCode = {
  device_code: "DEVICE_CODE_XYZ",
  user_code: "ABCD-1234",
  verification_uri: "https://example.com/device",
  verification_uri_complete: "https://example.com/device?user_code=ABCD-1234",
  expires_in: 300,
  interval: 5,
};

const sampleTokens = {
  access_token: "access_xxx",
  refresh_token: "refresh_yyy",
  user: {
    id: "user_01H",
    email: "user@example.com",
  },
};

interface StubCall {
  url: string;
  init?: RequestInit;
}

type StubPlan = {
  status?: number;
  body?: unknown;
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
      const body = plan.body !== undefined ? JSON.stringify(plan.body) : null;
      const headers = new Headers();
      if (plan.body !== undefined) headers.set("content-type", "application/json");
      return new Response(body, { status, headers });
    },
  };
}

const sleepNoop = async () => {};

describe("AuthFlow.login", () => {
  it("returns ok with tokens when device flow completes on first poll", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });

    const result = await flow.login();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.tokens.accessToken).toBe("access_xxx");
      expect(result.tokens.refreshToken).toBe("refresh_yyy");
      expect(result.tokens.userId).toBe("user_01H");
      expect(result.tokens.email).toBe("user@example.com");
      // expiresAt is seconds since epoch, on the same axis as JWT exp.
      expect(result.tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(result.tokens.expiresAt).toBeLessThan(1e10);
    }
  });

  it("polls authorize/device endpoint with client_id", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    await flow.login();
    expect(transport.calls[0]?.url).toBe(`${WORKOS_URL}/user_management/authorize/device`);
    const body = JSON.parse(transport.calls[0]?.init?.body as string);
    expect(body.client_id).toBe(CLIENT_ID);
  });

  it("polls authenticate endpoint with the correct grant_type and device_code", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    await flow.login();
    expect(transport.calls[1]?.url).toBe(`${WORKOS_URL}/user_management/authenticate`);
    const body = JSON.parse(transport.calls[1]?.init?.body as string);
    expect(body.grant_type).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(body.device_code).toBe("DEVICE_CODE_XYZ");
    expect(body.client_id).toBe(CLIENT_ID);
  });

  it("invokes onCode with user_code and verification URIs", async () => {
    let captured: {
      userCode: string;
      verificationUri: string;
      verificationUriComplete?: string;
    } | null = null;
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
      onCode: (info) => {
        captured = info;
      },
    });
    await flow.login();
    expect(captured).toEqual({
      userCode: "ABCD-1234",
      verificationUri: "https://example.com/device",
      verificationUriComplete: "https://example.com/device?user_code=ABCD-1234",
    });
  });

  it("retries when server reports authorization_pending", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("ok");
    expect(transport.calls).toHaveLength(4);
  });

  it("respects slow_down by increasing the poll interval", async () => {
    const sleeps: number[] = [];
    const transport = createStubTransport([
      { status: 200, body: { ...sampleDeviceCode, interval: 2 } },
      { status: 400, body: { error: "slow_down" } },
      { status: 200, body: sampleTokens },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await flow.login();
    expect(result.kind).toBe("ok");
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeGreaterThan(2000);
  });

  it("returns expired when server reports expired_token", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 400, body: { error: "expired_token" } },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("expired");
  });

  it("returns denied when user rejects the authorization", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 400, body: { error: "access_denied" } },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("denied");
  });

  it("returns transient when device-code request fails (network)", async () => {
    const transport = createStubTransport([{ throw: new Error("ENETDOWN") }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("transient");
  });

  it("returns transient when authenticate request fails (network)", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { throw: new Error("ECONNRESET") },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("transient");
  });

  it("returns transient when device-code response is malformed", async () => {
    const transport = createStubTransport([
      { status: 200, body: { foo: "bar" } },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("transient");
  });

  it("returns transient on 5xx during polling", async () => {
    const transport = createStubTransport([
      { status: 200, body: sampleDeviceCode },
      { status: 503, body: {} },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
      sleep: sleepNoop,
    });
    const result = await flow.login();
    expect(result.kind).toBe("transient");
  });
});

describe("AuthFlow.refresh", () => {
  it("returns fresh tokens on a successful redemption", async () => {
    const transport = createStubTransport([{ status: 200, body: { ...sampleTokens, expires_in: 300 } }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    const result = await flow.refresh("refresh-old");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.tokens.accessToken).toBe("access_xxx");
      expect(result.tokens.refreshToken).toBe("refresh_yyy");
      // expiresAt is seconds since epoch, on the same axis as JWT exp.
      expect(result.tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(result.tokens.expiresAt).toBeLessThan(1e10);
    }
  });

  it("POSTs to /user_management/authenticate with grant_type=refresh_token", async () => {
    const transport = createStubTransport([{ status: 200, body: sampleTokens }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    await flow.refresh("refresh-old");
    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0];
    expect(call.url).toBe(`${WORKOS_URL}/user_management/authenticate`);
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(String(call.init?.body));
    expect(body).toEqual({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: "refresh-old",
    });
  });

  it("returns kind=expired when WorkOS rejects the refresh token with a 4xx", async () => {
    const transport = createStubTransport([
      { status: 400, body: { error: "invalid_grant" } },
    ]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    const result = await flow.refresh("refresh-dead");
    expect(result.kind).toBe("expired");
    if (result.kind === "expired") {
      expect(result.message).toMatch(/invalid_grant/);
    }
  });

  it("returns kind=transient on 5xx so the caller can retry later", async () => {
    const transport = createStubTransport([{ status: 503, body: {} }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    const result = await flow.refresh("refresh-x");
    expect(result.kind).toBe("transient");
  });

  it("returns kind=transient when the transport itself throws", async () => {
    const transport = createStubTransport([{ throw: new Error("ECONNREFUSED") }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    const result = await flow.refresh("refresh-x");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/ECONNREFUSED/);
    }
  });

  it("returns kind=transient on a malformed 200 body so a stale refresh isn't treated as terminal", async () => {
    const transport = createStubTransport([{ status: 200, body: { unrelated: true } }]);
    const flow = createAuthFlow({
      clientId: CLIENT_ID,
      workosBaseUrl: WORKOS_URL,
      transport,
    });
    const result = await flow.refresh("refresh-x");
    expect(result.kind).toBe("transient");
  });
});
