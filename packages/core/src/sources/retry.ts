import type { RetryPolicy } from "../types";
import type { SourceOutcome, TranscriptSource } from "./types";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
};

export function withRetry(
  source: TranscriptSource,
  policy: RetryPolicy
): TranscriptSource {
  return {
    name: source.name,
    async fetch(videoId: string, signal?: AbortSignal): Promise<SourceOutcome> {
      let attempt = 0;
      let delay = policy.initialDelayMs;
      let lastTransient: SourceOutcome & { kind: "transient" } = {
        kind: "transient",
        cause: "no-attempts",
      };

      while (attempt < policy.maxAttempts) {
        if (signal?.aborted) {
          return { kind: "transient", cause: "aborted" };
        }

        const outcome = await source.fetch(videoId, signal);
        if (outcome.kind !== "transient") {
          return outcome;
        }

        lastTransient = outcome;
        attempt += 1;

        if (attempt >= policy.maxAttempts) break;

        const aborted = await sleep(delay, signal);
        if (aborted) {
          return { kind: "transient", cause: "aborted" };
        }
        delay = Math.floor(delay * policy.backoffMultiplier);
      }

      return lastTransient;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
