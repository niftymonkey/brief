import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractFrames,
  extractVideoId,
  type FramesResult,
  type MetadataResult,
  type SourceName,
  type TranscriptResult,
} from "@brief/core";
import { EXIT_ARG_ERROR, EXIT_OK, mapExitCode } from "../exit-codes";
import { render, type CombinedResult } from "../renderer";
import type { HandlerResult } from "./run-login";

export interface RunTranscriptDeps {
  fetchTranscript: (
    input: string,
    opts: {
      supadataApiKey?: string;
      sources?: SourceName[];
      signal?: AbortSignal;
    },
  ) => Promise<TranscriptResult>;
  fetchMetadata: (
    input: string,
    opts: {
      youtubeApiKey: string;
      signal?: AbortSignal;
    },
  ) => Promise<MetadataResult>;
  /**
   * Optional override for the frames pipeline. Production wires this to
   * `extractFrames` from @brief/core; tests stub it without touching yt-dlp or
   * the network. Only invoked when withFrames is true.
   */
  extractFrames?: typeof extractFrames;
}

export interface RunTranscriptOptions {
  input: string;
  json: boolean;
  noMetadata: boolean;
  withFrames?: boolean;
  sources?: SourceName[];
  signal?: AbortSignal;
  supadataKey?: string;
  youtubeKey?: string;
  openRouterKey?: string;
  ttyStderr?: boolean;
  bareShortcut?: boolean;
}

const SHORTCUT_TIP = "Tip: prefer `brief transcript <url>` for the explicit form.\n";

export async function runTranscript(
  deps: RunTranscriptDeps,
  opts: RunTranscriptOptions,
): Promise<HandlerResult> {
  // Fail fast on --with-frames misconfiguration so we don't burn the transcript
  // fetch only to discover we can't run the frames pipeline at the end.
  if (opts.withFrames && !opts.openRouterKey) {
    return {
      stdout: "",
      stderr: "Missing OPENROUTER_API_KEY (or --openrouter-key) — required for --with-frames.\n",
      exitCode: EXIT_ARG_ERROR,
    };
  }

  const transcriptOpts: {
    supadataApiKey?: string;
    sources?: SourceName[];
    signal?: AbortSignal;
  } = {};
  if (opts.supadataKey) transcriptOpts.supadataApiKey = opts.supadataKey;
  if (opts.sources) transcriptOpts.sources = opts.sources;
  if (opts.signal) transcriptOpts.signal = opts.signal;

  const transcriptPromise = deps.fetchTranscript(opts.input, transcriptOpts);

  const wantMetadata = !opts.noMetadata && !!opts.youtubeKey;
  const metadataPromise: Promise<MetadataResult | null> = wantMetadata
    ? deps.fetchMetadata(opts.input, {
        youtubeApiKey: opts.youtubeKey!,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    : Promise.resolve(null);

  const [transcript, metadata] = await Promise.all([transcriptPromise, metadataPromise]);

  const combined: CombinedResult = {
    videoIdOrUrl: opts.input,
    transcript,
    metadata,
  };

  const format = opts.json ? "json" : "human";
  const out = render(combined, format, !!opts.ttyStderr);
  const tip = opts.bareShortcut ? SHORTCUT_TIP : "";

  // No frames augmentation requested, transcript fetch failed, or json mode —
  // any of these short-circuits to the existing render.
  if (!opts.withFrames || transcript.kind !== "ok" || opts.json) {
    return {
      stdout: out.stdout ?? "",
      stderr: `${tip}${out.stderr ?? ""}`,
      exitCode: mapExitCode(transcript),
    };
  }

  const videoId = extractVideoId(opts.input);
  if (!videoId) {
    return {
      stdout: out.stdout ?? "",
      stderr: `${tip}${out.stderr ?? ""}Could not extract a YouTube video ID from "${opts.input}" — frames skipped.\n`,
      exitCode: mapExitCode(transcript),
    };
  }

  const workDir = join(tmpdir(), "brief-frames-cache", videoId);
  mkdirSync(workDir, { recursive: true });

  const framesFn = deps.extractFrames ?? extractFrames;
  const framesOpts: Parameters<typeof extractFrames>[0] = {
    videoId,
    transcript: transcript.entries,
    openRouterApiKey: opts.openRouterKey!,
    workDir,
  };
  if (opts.signal) framesOpts.signal = opts.signal;

  let framesResult: FramesResult;
  try {
    framesResult = await framesFn(framesOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: out.stdout ?? "",
      stderr: `${tip}${out.stderr ?? ""}Frames pipeline crashed: ${message}. Falling back to transcript-only.\n`,
      exitCode: mapExitCode(transcript),
    };
  }

  if (framesResult.kind === "attempted-failed") {
    return {
      stdout: out.stdout ?? "",
      stderr: `${tip}${out.stderr ?? ""}Note: frames pipeline failed (${framesResult.reason} at ${framesResult.phase}): ${framesResult.message}. Falling back to transcript-only.\n`,
      exitCode: mapExitCode(transcript),
    };
  }

  // Augmented happy path: the woven string IS the stdout output, so pipelines
  // like `brief transcript --with-frames | brief ask "..."` work directly.
  return {
    stdout: `${framesResult.transcript}\n`,
    stderr: tip,
    exitCode: EXIT_OK,
  };
}
