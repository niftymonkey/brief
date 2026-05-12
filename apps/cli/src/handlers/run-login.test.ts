import { describe, it, expect, vi } from "vitest";
import type { AuthFlow, AuthFlowResult } from "../auth";
import { createInMemoryStore } from "../credentials";
import { runLogin } from "./run-login";

function stubAuthFlow(result: AuthFlowResult): AuthFlow {
  return { login: vi.fn().mockResolvedValue(result) };
}

const sampleTokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: Date.now() + 3_600_000,
  userId: "user_01",
  email: "user@example.com",
};

describe("runLogin", () => {
  it("writes tokens to the store and prints the signed-in email on success", async () => {
    const credentials = createInMemoryStore();
    const authFlow = stubAuthFlow({ kind: "ok", tokens: sampleTokens });
    const result = await runLogin({ authFlow, credentials });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/user@example.com/);
    expect(await credentials.read()).toEqual(sampleTokens);
  });

  it("returns exit code 5 (auth-required) when login expires", async () => {
    const credentials = createInMemoryStore();
    const authFlow = stubAuthFlow({ kind: "expired", message: "Code expired" });
    const result = await runLogin({ authFlow, credentials });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toMatch(/expired/i);
    expect(await credentials.read()).toBeNull();
  });

  it("returns exit code 5 when user denies the authorization", async () => {
    const credentials = createInMemoryStore();
    const authFlow = stubAuthFlow({ kind: "denied", message: "User denied" });
    const result = await runLogin({ authFlow, credentials });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toMatch(/deni/i);
  });

  it("returns exit code 4 (transient) on network failures", async () => {
    const credentials = createInMemoryStore();
    const authFlow = stubAuthFlow({
      kind: "transient",
      cause: "ENETDOWN",
      message: "Network unreachable",
    });
    const result = await runLogin({ authFlow, credentials });

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/network|fail/i);
  });

  it("does not write to the store when login fails", async () => {
    const credentials = createInMemoryStore();
    const authFlow = stubAuthFlow({ kind: "expired", message: "Code expired" });
    await runLogin({ authFlow, credentials });
    expect(await credentials.read()).toBeNull();
  });
});
