import type { z } from "zod";
import {
  extractVideoId,
  TranscriptEntrySchema,
  type SourceName,
  type TranscriptResult,
  type TranscriptSubmission,
} from "@brief/core";
import {
  EXIT_ARG_ERROR,
  EXIT_AUTH_REQUIRED,
  EXIT_OK,
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
}

export interface RunGenerateOptions {
  input: string;
  json: boolean;
  withFrames: boolean;
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
      exitCode: EXIT_TRANSIENT,
    };
  }

  // Frames pipeline lands in #87; v1 always submits `not-requested`.
  const submission: TranscriptSubmission = {
    schemaVersion: "2.0.0",
    videoId,
    transcript: toSubmissionEntries(transcript),
    frames: { kind: "not-requested" },
  };

  const noticeStderr = opts.withFrames
    ? "Note: `--with-frames` accepted but not yet wired (frames pipeline lands in #87). Submitting transcript-only.\n"
    : "";

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
