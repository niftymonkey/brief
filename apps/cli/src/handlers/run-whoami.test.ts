import { describe, it, expect, vi } from "vitest";
import type { HostedClient, IdentityResult } from "../hosted-client";
import { runWhoami } from "./run-whoami";

function stubHostedClient(result: IdentityResult): HostedClient {
  return {
    submit: vi.fn(),
    whoami: vi.fn().mockResolvedValue(result),
    logout: vi.fn(),
  };
}

describe("runWhoami", () => {
  it("prints email on stdout when authenticated", async () => {
    const hostedClient = stubHostedClient({
      kind: "ok",
      email: "user@example.com",
      userId: "user_01",
    });

    const result = await runWhoami({ hostedClient }, { json: false });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("user@example.com");
  });

  it("prints structured JSON on stdout when --json is set", async () => {
    const hostedClient = stubHostedClient({
      kind: "ok",
      email: "user@example.com",
      userId: "user_01",
    });

    const result = await runWhoami({ hostedClient }, { json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({ email: "user@example.com", userId: "user_01" });
  });

  it("returns exit code 5 with a 'not signed in' message when no creds", async () => {
    const hostedClient = stubHostedClient({
      kind: "auth-required",
      reason: "missing",
    });

    const result = await runWhoami({ hostedClient }, { json: false });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toMatch(/not signed in/i);
  });

  it("returns exit code 5 with an 'expired' message when token expired", async () => {
    const hostedClient = stubHostedClient({
      kind: "auth-required",
      reason: "expired",
    });

    const result = await runWhoami({ hostedClient }, { json: false });

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toMatch(/expired|sign in/i);
  });

  it("returns exit code 4 on transient errors", async () => {
    const hostedClient = stubHostedClient({
      kind: "transient",
      cause: "ENETDOWN",
      message: "Server unreachable",
    });

    const result = await runWhoami({ hostedClient }, { json: false });

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/server|unreachable/i);
  });

  it("returns exit code 4 when hostedClient.whoami throws unexpectedly", async () => {
    const hostedClient: HostedClient = {
      submit: vi.fn(),
      whoami: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      logout: vi.fn(),
    };
    const result = await runWhoami({ hostedClient }, { json: false });
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toMatch(/ECONNRESET|server/i);
  });
});
