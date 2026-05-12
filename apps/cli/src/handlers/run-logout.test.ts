import { describe, it, expect, vi } from "vitest";
import type { HostedClient, LogoutResult } from "../hosted-client";
import { createInMemoryStore, type Tokens } from "../credentials";
import { runLogout } from "./run-logout";

const sampleTokens: Tokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  userId: "user_01",
  email: "user@example.com",
};

function stubHostedClient(result: LogoutResult): HostedClient {
  return {
    submit: vi.fn(),
    whoami: vi.fn(),
    logout: vi.fn().mockResolvedValue(result),
  };
}

describe("runLogout", () => {
  it("clears local credentials and exits 0 when server ack's the revoke", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const hostedClient = stubHostedClient({ kind: "ok" });

    const result = await runLogout({ hostedClient, credentials });

    expect(result.exitCode).toBe(0);
    expect(await credentials.read()).toBeNull();
  });

  it("still clears local credentials even when server returns transient", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const hostedClient = stubHostedClient({
      kind: "transient",
      cause: "ECONNREFUSED",
      message: "Server unreachable",
    });

    const result = await runLogout({ hostedClient, credentials });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/server|unreachable|note/i);
    expect(await credentials.read()).toBeNull();
  });

  it("succeeds as a no-op when no credentials are stored", async () => {
    const credentials = createInMemoryStore();
    const hostedClient = stubHostedClient({ kind: "ok" });

    const result = await runLogout({ hostedClient, credentials });

    expect(result.exitCode).toBe(0);
  });

  it("still clears local credentials when hostedClient.logout throws", async () => {
    const credentials = createInMemoryStore();
    await credentials.write(sampleTokens);
    const hostedClient: HostedClient = {
      submit: vi.fn(),
      whoami: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error("unexpected")),
    };
    const result = await runLogout({ hostedClient, credentials });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/unexpect|note/i);
    expect(await credentials.read()).toBeNull();
  });
});
