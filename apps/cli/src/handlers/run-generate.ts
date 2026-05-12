import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import {
  extractFrames,
  extractVideoId,
  SUBMISSION_SCHEMA_VERSION,
  TranscriptEntrySchema,
  type FramesResult,
  type SourceName,
  type TranscriptResult,
  type TranscriptSubmission,
} from "@brief/core";
import {
  EXIT_ARG_ERROR,
  EXIT_AUTH_REQUIRED,
  EXIT_OK,
  EXIT_PENDING,
  EXIT_SCHEMA_MISMATCH,
  EXIT_TRANSIENT,
  EXIT_UNAVAILABLE,
} from "../exit-codes";
import type { HostedClient } from "../hosted-client";
import type { HandlerResult } from "./run-login";

type SumTypeEntry = z.infer<typeof TranscriptEntrySchema>;

export interface RunGenerateDeps {
  fetchTranscript: (
    input: string,
    opts: {
      supadataApiKey?: string;
      sources?: SourceName[];
      signal?: AbortSignal;
    },
  ) => Promise<TranscriptResult>;
  hostedClient: HostedClient;
  progress: (line: string) => void;
}

export interface RunGenerateOptions {
  input: string;
  json: boolean;
  withFrames: boolean;
  openRouterKey?: string;
  sources?: SourceName[];
  signal?: AbortSignal;
  supadataKey?: string;
}

function toSubmissionEntries(transcript: TranscriptResult & { kind: "ok" }): SumTypeEntry[] {
  return transcript.entries.map((e) => {
    const out: SumTypeEntry = {
      kind: "speech",
      offsetSec: e.offsetSec,
      durationSec: e.durationSec,
      text: e.text,
    };
    if (e.lang !== undefined) out.lang = e.lang;
    return out;
  });
}

export async function runGenerate(
  deps: RunGenerateDeps,
  opts: RunGenerateOptions,
): Promise<HandlerResult> {
  const videoId = extractVideoId(opts.input);
  if (!videoId) {
    return {
      stdout: "",
      stderr: `Could not extract a YouTube video ID from "${opts.input}"\n`,
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

  deps.progress("Fetching transcript...");
  const transcript = await deps.fetchTranscript(opts.input, transcriptOpts);
  if (transcript.kind === "unavailable") {
    return {
      stdout: "",
      stderr: `Transcript unavailable (${transcript.reason}): ${transcript.message}\n`,
      exitCode: EXIT_UNAVAILABLE,
    };
  }
  if (transcript.kind === "transient") {
    return {
      stdout: "",
      stderr: `Transcript fetch failed: ${transcript.message}\n`,
      exitCode: EXIT_TRANSIENT,
    };
  }
  if (transcript.kind === "pending") {
    return {
      stdout: "",
      stderr: `Transcript is being generated (jobId ${transcript.jobId}). Try again in ${transcript.retryAfterSeconds}s.\n`,
      exitCode: EXIT_PENDING,
    };
  }

  let framesResult: FramesResult | null = null;
  let framesNotice = "";
  if (opts.withFrames) {
    if (!opts.openRouterKey) {
      return {
        stdout: "",
        stderr: "Missing OPENROUTER_API_KEY (or --openrouter-key) — required for --with-frames.\n",
        exitCode: EXIT_ARG_ERROR,
      };
    }
    // Cache video bytes + extracted frames per videoId so subsequent runs against
    // the same video reuse the download and the per-timestamp PNGs. yt-dlp and
    // ffmpeg both short-circuit when their output files already exist. Cleared
    // automatically when the OS rotates its tempdir (typically on reboot).
    const workDir = join(tmpdir(), "brief-frames-cache", videoId);
    mkdirSync(workDir, { recursive: true });
    deps.progress(`Extracting frames... (cached at ${workDir}; first run ~1–3 min, re-runs skip download + frame extraction)`);
    const framesOpts: Parameters<typeof extractFrames>[0] = {
      videoId,
      transcript: transcript.entries,
      openRouterApiKey: opts.openRouterKey,
      workDir,
    };
    if (opts.signal) framesOpts.signal = opts.signal;
    framesResult = await extractFrames(framesOpts);
    if (framesResult.kind === "attempted-failed") {
      framesNotice = `Note: frames pipeline failed (${framesResult.reason} at ${framesResult.phase}): ${framesResult.message}. Submitting transcript-only.\n`;
    }
  }

  const submission: TranscriptSubmission = {
    schemaVersion: SUBMISSION_SCHEMA_VERSION,
    videoId,
    transcript: toSubmissionEntries(transcript),
    frames:
      framesResult?.kind === "included"
        ? {
            kind: "included",
            transcript: framesResult.transcript,
            metrics: framesResult.metrics,
          }
        : framesResult?.kind === "attempted-failed"
          ? {
              kind: "attempted-failed",
              reason: framesResult.reason,
              phase: framesResult.phase,
              metrics: framesResult.metrics,
            }
          : { kind: "not-requested" },
  };

  const noticeStderr = framesNotice;

  deps.progress("Generating brief on the server... (typically 5–15s)");
  const result = await deps.hostedClient.submit(submission);

  switch (result.kind) {
    case "ok":
      return {
        stdout: opts.json
          ? `${JSON.stringify(result)}\n`
          : `${result.briefUrl}\n`,
        stderr: noticeStderr,
        exitCode: EXIT_OK,
      };
    case "auth-required":
      return {
        stdout: "",
        stderr: `${noticeStderr}Not signed in. Run \`brief login\` first.\n`,
        exitCode: EXIT_AUTH_REQUIRED,
      };
    case "schema-mismatch":
      return {
        stdout: "",
        stderr: `${noticeStderr}This brief CLI is out of date. Please upgrade. (server accepts: ${result.serverAccepts.join(", ")})\n`,
        exitCode: EXIT_SCHEMA_MISMATCH,
      };
    case "rate-limited":
      return {
        stdout: "",
        stderr: `${noticeStderr}Daily quota reached. Try again in ${result.retryAfterSeconds}s.\n`,
        exitCode: EXIT_TRANSIENT,
      };
    case "transient":
      return {
        stdout: "",
        stderr: `${noticeStderr}Server temporarily unavailable: ${result.message}\n`,
        exitCode: EXIT_TRANSIENT,
      };
  }
}
