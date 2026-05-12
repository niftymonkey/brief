import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  askVideo,
  extractFrames,
  extractVideoId,
  fetchTranscript,
  type AskVideoResult,
  type FramesResult,
  type SourceName,
  type TranscriptResult,
} from "@brief/core";
import {
  EXIT_ARG_ERROR,
  EXIT_OK,
  EXIT_TRANSIENT,
  EXIT_UNAVAILABLE,
} from "../exit-codes";
import type { HandlerResult } from "./run-login";

/**
 * `brief ask` reads or builds a video transcript and answers a question about
 * it via a single OpenRouter LLM call. Two input modes, differentiated by
 * whether stdin is connected to a TTY:
 *
 * - **URL mode** (`brief ask <url> "<question>"`): runs the local
 *   transcript-with-frames pipeline (which uses the per-videoId disk cache,
 *   so re-runs against the same video are near-instant), then asks.
 * - **Stdin mode** (`brief ask "<question>"`, with a transcript piped in):
 *   reads the transcript from stdin and asks. No frames pipeline run.
 *
 * No server contact, no DB writes, no brief row. The answer is printed to
 * stdout and the process exits.
 */
export interface RunAskDeps {
  fetchTranscript: typeof fetchTranscript;
  extractFrames: typeof extractFrames;
  askVideo: typeof askVideo;
  /** Reads stdin to completion. Production passes a `process.stdin` reader; tests inject a string. */
  readStdin: () => Promise<string>;
  progress: (line: string) => void;
}

export interface RunAskOptions {
  /** When supplied, run URL mode (extract → ask). When omitted, run stdin mode. */
  input?: string;
  question: string;
  openRouterKey?: string;
  supadataKey?: string;
  sources?: SourceName[];
  signal?: AbortSignal;
}

export async function runAsk(
  deps: RunAskDeps,
  opts: RunAskOptions,
): Promise<HandlerResult> {
  if (!opts.question.trim()) {
    return {
      stdout: "",
      stderr: "Missing question. Usage: brief ask <url-or-id> \"<question>\"  (or pipe a transcript: <transcript> | brief ask \"<question>\")\n",
      exitCode: EXIT_ARG_ERROR,
    };
  }

  // Stdin mode: short-circuit straight to askVideo. No transcript fetch, no
  // frames pipeline, no videoId resolution.
  if (!opts.input) {
    if (!opts.openRouterKey) {
      return {
        stdout: "",
        stderr: "Missing OPENROUTER_API_KEY (or --openrouter-key) — required to ask.\n",
        exitCode: EXIT_ARG_ERROR,
      };
    }
    const piped = await deps.readStdin();
    if (!piped.trim()) {
      return {
        stdout: "",
        stderr: "Stdin is empty and no <url-or-id> was given. Pass a video URL, or pipe a transcript on stdin.\n",
        exitCode: EXIT_ARG_ERROR,
      };
    }
    return runAskCall(deps, opts, piped);
  }

  // URL mode: resolve videoId, fetch transcript, run frames pipeline (which is
  // a near-no-op on cache hit), then ask.
  const videoId = extractVideoId(opts.input);
  if (!videoId) {
    return {
      stdout: "",
      stderr: `Could not extract a YouTube video ID from "${opts.input}".\n`,
      exitCode: EXIT_ARG_ERROR,
    };
  }

  if (!opts.openRouterKey) {
    return {
      stdout: "",
      stderr: "Missing OPENROUTER_API_KEY (or --openrouter-key) — required for ask.\n",
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
  const transcript: TranscriptResult = await deps.fetchTranscript(opts.input, transcriptOpts);
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

  const workDir = join(tmpdir(), "brief-frames-cache", videoId);
  mkdirSync(workDir, { recursive: true });

  deps.progress("Preparing augmented transcript... (cache hit if you've run --with-frames on this video before)");
  const framesOpts: Parameters<typeof extractFrames>[0] = {
    videoId,
    transcript: transcript.entries,
    openRouterApiKey: opts.openRouterKey,
    workDir,
  };
  if (opts.signal) framesOpts.signal = opts.signal;

  let framesResult: FramesResult;
  try {
    framesResult = await deps.extractFrames(framesOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: `Frames pipeline crashed: ${message}\n`,
      exitCode: EXIT_TRANSIENT,
    };
  }

  // Even on attempted-failed we have *some* transcript to ask against — the
  // speech entries. Fall back to a formatted speech-only string so the user
  // still gets an answer, just without on-screen content.
  const transcriptText =
    framesResult.kind === "included"
      ? framesResult.transcript
      : formatSpeechOnly(transcript);

  const framesNotice =
    framesResult.kind === "attempted-failed"
      ? `Note: frames pipeline failed (${framesResult.reason} at ${framesResult.phase}): ${framesResult.message}. Asking against transcript only.\n`
      : "";

  return runAskCall(deps, opts, transcriptText, framesNotice);
}

async function runAskCall(
  deps: RunAskDeps,
  opts: RunAskOptions,
  transcript: string,
  noticeStderr = "",
): Promise<HandlerResult> {
  deps.progress("Asking the model... (typically 5–15s)");
  const askOpts: Parameters<typeof askVideo>[0] = {
    transcript,
    question: opts.question,
    openRouterApiKey: opts.openRouterKey!,
  };
  if (opts.signal) askOpts.signal = opts.signal;
  const result: AskVideoResult = await deps.askVideo(askOpts);

  if (result.kind === "failed") {
    return {
      stdout: "",
      stderr: `${noticeStderr}Ask failed (${result.reason}): ${result.message}\n`,
      exitCode: result.reason === "auth" ? EXIT_ARG_ERROR : EXIT_TRANSIENT,
    };
  }

  return {
    stdout: `${result.answer}\n`,
    stderr: noticeStderr,
    exitCode: EXIT_OK,
  };
}

function formatSpeechOnly(transcript: TranscriptResult & { kind: "ok" }): string {
  return transcript.entries
    .map((e) => {
      const min = Math.floor(e.offsetSec / 60);
      const sec = Math.floor(e.offsetSec % 60);
      return `[${min}:${sec.toString().padStart(2, "0")}] ${e.text}`;
    })
    .join("\n");
}
