import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRY_POLICY, withRetry } from "./retry";
import type { TranscriptSource, SourceOutcome } from "./types";

function makeStub(outcomes: SourceOutcome[]): TranscriptSource & {
  calls: number;
} {
  let i = 0;
  const stub = {
    name: "youtube-transcript-plus" as const,
    calls: 0,
    async fetch(): Promise<SourceOutcome> {
      stub.calls += 1;
      const outcome = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      return outcome;
    },
  };
  return stub;
}

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ok on first success without retrying", async () => {
    const stub = makeStub([{ kind: "ok", entries: [] }]);
    const wrapped = withRetry(stub, DEFAULT_RETRY_POLICY);
    const promise = wrapped.fetch("vid");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.kind).toBe("ok");
    expect(stub.calls).toBe(1);
  });

  it("short-circuits on pending without retrying", async () => {
    const stub = makeStub([
      { kind: "pending", jobId: "j", retryAfterSeconds: 90 },
    ]);
    const wrapped = withRetry(stub, DEFAULT_RETRY_POLICY);
    const promise = wrapped.fetch("vid");
    await vi.runAllTimersAsync();
    await promise;
    expect(stub.calls).toBe(1);
  });

  it("short-circuits on unavailable without retrying", async () => {
    const stub = makeStub([{ kind: "unavailable", reason: "no-captions" }]);
    const wrapped = withRetry(stub, DEFAULT_RETRY_POLICY);
    const promise = wrapped.fetch("vid");
    await vi.runAllTimersAsync();
    await promise;
    expect(stub.calls).toBe(1);
  });

  it("retries on transient up to maxAttempts", async () => {
    const stub = makeStub([
      { kind: "transient", cause: "net" },
      { kind: "transient", cause: "net" },
      { kind: "transient", cause: "net" },
    ]);
    const wrapped = withRetry(stub, {
      maxAttempts: 3,
      initialDelayMs: 10,
      backoffMultiplier: 2,
    });
    const promise = wrapped.fetch("vid");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(stub.calls).toBe(3);
    expect(result.kind).toBe("transient");
  });

  it("returns ok after a transient retry succeeds", async () => {
    const stub = makeStub([
      { kind: "transient", cause: "net" },
      { kind: "ok", entries: [] },
    ]);
    const wrapped = withRetry(stub, {
      maxAttempts: 3,
      initialDelayMs: 10,
      backoffMultiplier: 2,
    });
    const promise = wrapped.fetch("vid");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(stub.calls).toBe(2);
    expect(result.kind).toBe("ok");
  });

  it("respects an AbortSignal that fires mid-backoff", async () => {
    const stub = makeStub([
      { kind: "transient", cause: "net" },
      { kind: "ok", entries: [] },
    ]);
    const wrapped = withRetry(stub, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
    });
    const controller = new AbortController();
    const promise = wrapped.fetch("vid", controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("aborted");
    }
    expect(stub.calls).toBe(1);
  });

  it("applies exponential backoff between attempts", async () => {
    const stub = makeStub([
      { kind: "transient", cause: "net" },
      { kind: "transient", cause: "net" },
      { kind: "ok", entries: [] },
    ]);
    const wrapped = withRetry(stub, {
      maxAttempts: 5,
      initialDelayMs: 100,
      backoffMultiplier: 3,
    });
    const promise = wrapped.fetch("vid");

    await vi.advanceTimersByTimeAsync(50);
    expect(stub.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(60);
    expect(stub.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(200);
    expect(stub.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(150);
    expect(stub.calls).toBe(3);

    await vi.runAllTimersAsync();
    await promise;
  });
});
