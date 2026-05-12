import { parseArgs } from "node:util";
import {
  fetchMetadata,
  fetchTranscript,
  type MetadataResult,
  type SourceName,
  type TranscriptResult,
} from "@brief/core";
import { createAuthFlow } from "./auth";
import { createFilesystemStore } from "./credentials";
import { EXIT_ARG_ERROR, mapExitCode } from "./exit-codes";
import { createHostedClient } from "./hosted-client";
import { runLogin } from "./handlers/run-login";
import { runLogout } from "./handlers/run-logout";
import { runWhoami } from "./handlers/run-whoami";
import { render, type CombinedResult } from "./renderer";

const DEFAULT_API_BASE = "https://brief.niftymonkey.dev";

const USAGE = `Usage:
  brief <subcommand> [options]
  brief <url-or-id> [options]              # shortcut for: brief transcript <url-or-id>

Subcommands:
  login                                    Sign in via WorkOS device flow
  logout                                   Sign out (clears local credentials)
  whoami [--json]                          Show the signed-in account
  <url-or-id> [options]                    Fetch a YouTube transcript (legacy positional form)

Options (transcript flow):
  --json                                   Emit machine-readable JSON
  --no-metadata                            Skip YouTube Data API metadata fetch
  --source=<auto|local|supadata>           Override the cascade. Default: auto.
  --timeout=<ms>                           Overall request budget in ms
  --supadata-key=<key>                     Override SUPADATA_API_KEY env var
  --youtube-key=<key>                      Override YOUTUBE_API_KEY env var
  --help                                   Show this help

Environment:
  BRIEF_API_URL                            Hosted brief service URL (default: ${DEFAULT_API_BASE})
  WORKOS_CLIENT_ID                         WorkOS client ID (required for login)

Exit codes:
  0  Success
  1  Argument or unexpected error
  2  Async generation queued (jobId in output)
  3  Permanently unavailable
  4  Transient failure
  5  Authentication required (run \`brief login\`)
  6  CLI / server schema mismatch (upgrade brief)`;

type ParsedTranscript = {
  values: {
    json?: boolean;
    "no-metadata"?: boolean;
    source?: string;
    timeout?: string;
    "supadata-key"?: string;
    "youtube-key"?: string;
    help?: boolean;
  };
  positionals: string[];
};

function parseTranscriptArgs(argv: string[]): ParsedTranscript {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "no-metadata": { type: "boolean" },
      source: { type: "string" },
      timeout: { type: "string" },
      "supadata-key": { type: "string" },
      "youtube-key": { type: "string" },
      help: { type: "boolean" },
    },
  });
}

function mapSource(value: string | undefined): SourceName[] | undefined {
  if (!value || value === "auto") return undefined;
  if (value === "local") return ["youtube-transcript-plus"];
  if (value === "supadata") return ["supadata"];
  throw new Error(`Invalid --source=${value}; expected auto|local|supadata`);
}

function writeResult(result: { stdout: string; stderr: string; exitCode: number }): number {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

function getApiBase(): string {
  return process.env.BRIEF_API_URL ?? DEFAULT_API_BASE;
}

async function dispatchLogin(): Promise<number> {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    process.stderr.write(
      "Login requires WORKOS_CLIENT_ID env var. Ask brief support for the value.\n",
    );
    return EXIT_ARG_ERROR;
  }
  const authFlow = createAuthFlow({
    clientId,
    onCode: (info) => {
      const display = info.verificationUriComplete ?? info.verificationUri;
      process.stderr.write(
        `\nTo sign in, visit:\n  ${display}\n\nAnd enter the code:\n  ${info.userCode}\n\nWaiting for authorization...\n\n`,
      );
    },
  });
  const credentials = createFilesystemStore();
  return writeResult(await runLogin({ authFlow, credentials }));
}

async function dispatchLogout(): Promise<number> {
  const credentials = createFilesystemStore();
  const hostedClient = createHostedClient({ baseUrl: getApiBase(), credentials });
  return writeResult(await runLogout({ hostedClient, credentials }));
}

async function dispatchWhoami(argv: string[]): Promise<number> {
  let json = false;
  try {
    const parsed = parseArgs({
      args: argv,
      options: { json: { type: "boolean" } },
    });
    json = !!parsed.values.json;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ARG_ERROR;
  }
  const credentials = createFilesystemStore();
  const hostedClient = createHostedClient({ baseUrl: getApiBase(), credentials });
  return writeResult(await runWhoami({ hostedClient }, { json }));
}

async function dispatchLegacyTranscript(argv: string[]): Promise<number> {
  let parsed: ParsedTranscript;
  try {
    parsed = parseTranscriptArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n\n${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }

  if (parsed.values.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }

  const positional = parsed.positionals[0];
  if (!positional) {
    process.stderr.write(`Missing positional argument <url-or-id>\n\n${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }

  let sources: SourceName[] | undefined;
  try {
    sources = mapSource(parsed.values.source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    return EXIT_ARG_ERROR;
  }

  const supadataKey = parsed.values["supadata-key"] ?? process.env.SUPADATA_API_KEY;
  const youtubeKey = parsed.values["youtube-key"] ?? process.env.YOUTUBE_API_KEY;

  if (parsed.values.source === "supadata" && !supadataKey) {
    process.stderr.write(
      `--source=supadata requires SUPADATA_API_KEY or --supadata-key\n`,
    );
    return EXIT_ARG_ERROR;
  }

  let signal: AbortSignal | undefined;
  if (parsed.values.timeout) {
    const ms = Number(parsed.values.timeout);
    if (!Number.isFinite(ms) || ms <= 0) {
      process.stderr.write(`--timeout must be a positive number of ms\n`);
      return EXIT_ARG_ERROR;
    }
    signal = AbortSignal.timeout(ms);
  }

  const wantMetadata = !parsed.values["no-metadata"] && !!youtubeKey;

  const transcriptPromise: Promise<TranscriptResult> = fetchTranscript(positional, {
    ...(supadataKey ? { supadataApiKey: supadataKey } : {}),
    ...(sources ? { sources } : {}),
    ...(signal ? { signal } : {}),
  });
  const metadataPromise: Promise<MetadataResult | null> = wantMetadata
    ? fetchMetadata(positional, {
        youtubeApiKey: youtubeKey!,
        ...(signal ? { signal } : {}),
      })
    : Promise.resolve(null);

  const [transcript, metadata] = await Promise.all([transcriptPromise, metadataPromise]);

  const combined: CombinedResult = {
    videoIdOrUrl: positional,
    transcript,
    metadata,
  };

  const format = parsed.values.json ? "json" : "human";
  const out = render(combined, format, !!process.stderr.isTTY);
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);

  return mapExitCode(transcript);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  switch (subcommand) {
    case "login":
      return dispatchLogin();
    case "logout":
      return dispatchLogout();
    case "whoami":
      return dispatchWhoami(argv.slice(1));
    default:
      return dispatchLegacyTranscript(argv);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Unexpected error: ${msg}\n`);
    process.exit(EXIT_ARG_ERROR);
  },
);
