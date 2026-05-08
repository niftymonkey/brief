import type { SourceName, TranscriptEntry, UnavailableReason } from "../types";

export type SourceOutcome =
  | { kind: "ok"; lang?: string; entries: TranscriptEntry[] }
  | { kind: "pending"; jobId: string; retryAfterSeconds: number }
  | { kind: "unavailable"; reason: UnavailableReason }
  | { kind: "transient"; cause: string };

export interface TranscriptSource {
  readonly name: SourceName;
  fetch(videoId: string, signal?: AbortSignal): Promise<SourceOutcome>;
}
