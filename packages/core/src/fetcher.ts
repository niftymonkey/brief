import { extractVideoId } from "./parser";
import { LocalSource } from "./sources/local";
import { DEFAULT_RETRY_POLICY, withRetry } from "./sources/retry";
import { SupadataSource } from "./sources/supadata";
import type { SourceOutcome, TranscriptSource } from "./sources/types";
import type {
  SourceName,
  TranscriptOptions,
  TranscriptResult,
} from "./types";

const DEFAULT_SOURCES: SourceName[] = ["youtube-transcript-plus", "supadata"];

export async function fetchTranscript(
  input: string,
  opts: TranscriptOptions = {}
): Promise<TranscriptResult> {
  const videoId = extractVideoId(input);
  if (!videoId) {
    return {
      kind: "unavailable",
      reason: "invalid-id",
      message: `Could not extract a YouTube video ID from "${input}"`,
    };
  }

  if (opts.signal?.aborted) {
    return {
      kind: "transient",
      cause: "aborted",
      message: "Request aborted before any source was tried",
    };
  }

  if (opts.cache) {
    const cached = await opts.cache.get(videoId);
    if (cached) return cached;
  }

  const sources = buildSources(opts);
  if (sources.length === 0) {
    return {
      kind: "transient",
      cause: "no-sources",
      message:
        "No transcript sources available for this configuration (Supadata key may be missing)",
    };
  }

  const policy = opts.retryPolicy ?? DEFAULT_RETRY_POLICY;
  let bestNonTerminal: TranscriptResult | null = null;

  for (const source of sources) {
    if (opts.signal?.aborted) {
      return {
        kind: "transient",
        cause: "aborted",
        message: "Request aborted mid-cascade",
      };
    }

    const decorated = withRetry(source, policy);
    const outcome = await decorated.fetch(videoId, opts.signal);
    const result = decorate(outcome, source.name);

    if (result.kind === "ok") {
      await writeCache(opts, videoId, result);
      return result;
    }

    if (result.kind === "pending") {
      return result;
    }

    if (result.kind === "unavailable") {
      bestNonTerminal = result;
      continue;
    }

    if (!bestNonTerminal || bestNonTerminal.kind !== "unavailable") {
      bestNonTerminal = result;
    }
  }

  return (
    bestNonTerminal ?? {
      kind: "transient",
      cause: "exhausted",
      message: "All transcript sources exhausted",
    }
  );
}

function buildSources(opts: TranscriptOptions): TranscriptSource[] {
  const requested = opts.sources ?? DEFAULT_SOURCES;
  const sources: TranscriptSource[] = [];

  for (const name of requested) {
    if (name === "youtube-transcript-plus") {
      sources.push(new LocalSource());
    } else if (name === "supadata") {
      if (!opts.supadataApiKey) continue;
      sources.push(new SupadataSource(opts.supadataApiKey));
    }
  }

  return sources;
}

function decorate(
  outcome: SourceOutcome,
  source: SourceName
): TranscriptResult {
  switch (outcome.kind) {
    case "ok":
      return {
        kind: "ok",
        source,
        ...(outcome.lang ? { lang: outcome.lang } : {}),
        entries: outcome.entries,
      };
    case "pending":
      return {
        kind: "pending",
        source,
        jobId: outcome.jobId,
        retryAfterSeconds: outcome.retryAfterSeconds,
        message: `Transcript generation queued by ${source}`,
      };
    case "unavailable":
      return {
        kind: "unavailable",
        reason: outcome.reason,
        message: messageForUnavailable(outcome.reason),
      };
    case "transient":
      return {
        kind: "transient",
        cause: outcome.cause,
        message: `Transient failure (${outcome.cause}) from ${source}`,
      };
  }
}

function messageForUnavailable(reason: string): string {
  switch (reason) {
    case "no-captions":
      return "No captions or transcript available for this video";
    case "video-removed":
      return "Video is unavailable or has been removed";
    case "video-private":
      return "Video is private";
    case "invalid-id":
      return "Invalid video ID";
    default:
      return "Transcript unavailable";
  }
}

async function writeCache(
  opts: TranscriptOptions,
  videoId: string,
  result: TranscriptResult
): Promise<void> {
  if (!opts.cache) return;
  try {
    await opts.cache.set(videoId, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[transcript] cache.set failed for ${videoId}: ${msg}`);
  }
}
