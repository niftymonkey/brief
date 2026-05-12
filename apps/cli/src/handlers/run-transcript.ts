import type {
  MetadataResult,
  SourceName,
  TranscriptResult,
} from "@brief/core";
import { mapExitCode } from "../exit-codes";
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
}

export interface RunTranscriptOptions {
  input: string;
  json: boolean;
  noMetadata: boolean;
  sources?: SourceName[];
  signal?: AbortSignal;
  supadataKey?: string;
  youtubeKey?: string;
  ttyStderr?: boolean;
  bareShortcut?: boolean;
}

const SHORTCUT_TIP = "Tip: prefer `brief transcript <url>` for the explicit form.\n";

export async function runTranscript(
  deps: RunTranscriptDeps,
  opts: RunTranscriptOptions,
): Promise<HandlerResult> {
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

  return {
    stdout: out.stdout ?? "",
    stderr: `${tip}${out.stderr ?? ""}`,
    exitCode: mapExitCode(transcript),
  };
}
