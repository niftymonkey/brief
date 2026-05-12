import { parseArgs } from "node:util";
import { fetchMetadata, fetchTranscript, type SourceName } from "@brief/core";
import { createAuthFlow } from "./auth";
import { createFilesystemStore } from "./credentials";
import { EXIT_ARG_ERROR } from "./exit-codes";
import { createHostedClient } from "./hosted-client";
import { runGenerate } from "./handlers/run-generate";
import { runLogin } from "./handlers/run-login";
import { runLogout } from "./handlers/run-logout";
import { runTranscript } from "./handlers/run-transcript";
import { runWhoami } from "./handlers/run-whoami";

const DEFAULT_API_BASE = "https://brief.niftymonkey.dev";

const USAGE = `Usage:
  brief <subcommand> [options]
  brief <url-or-id> [options]              # shortcut for: brief transcript <url-or-id>

Subcommands:
  login                                    Sign in via WorkOS device flow
  logout                                   Sign out (clears local credentials)
  whoami [--json]                          Show the signed-in account
  transcript <url-or-id> [options]         Fetch a YouTube transcript locally
  generate <url-or-id> [options]           Generate a brief on brief.niftymonkey.dev (requires login)

Options:
  --json                                   Emit machine-readable JSON
  --no-metadata                            (transcript) Skip video-metadata fetch in the header
  --with-frames                            (placeholder; frames pipeline lands in #87)
  --source=<auto|local|supadata>           Override the transcript cascade
  --timeout=<ms>                           Overall request budget
  --supadata-key=<key>                     Override SUPADATA_API_KEY env var
  --youtube-key=<key>                      (transcript) Override YOUTUBE_API_KEY env var
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

type ParsedFlags = {
  values: {
    json?: boolean;
    "no-metadata"?: boolean;
    "with-frames"?: boolean;
    source?: string;
    timeout?: string;
    "supadata-key"?: string;
    "youtube-key"?: string;
    help?: boolean;
  };
  positionals: string[];
};

function parseFlags(argv: string[]): ParsedFlags {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "no-metadata": { type: "boolean" },
      "with-frames": { type: "boolean" },
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

interface ParsedCommon {
  input: string;
  json: boolean;
  noMetadata: boolean;
  withFrames: boolean;
  sources?: SourceName[];
  signal?: AbortSignal;
  supadataKey?: string;
  youtubeKey?: string;
}

function buildCommonOpts(parsed: ParsedFlags): ParsedCommon | { error: string } {
  const positional = parsed.positionals[0];
  if (!positional) return { error: `Missing positional argument <url-or-id>\n\n${USAGE}\n` };

  let sources: SourceName[] | undefined;
  try {
    sources = mapSource(parsed.values.source);
  } catch (err) {
    return { error: `${err instanceof Error ? err.message : String(err)}\n` };
  }

  let signal: AbortSignal | undefined;
  if (parsed.values.timeout) {
    const ms = Number(parsed.values.timeout);
    if (!Number.isFinite(ms) || ms <= 0) {
      return { error: "--timeout must be a positive number of ms\n" };
    }
    signal = AbortSignal.timeout(ms);
  }

  const supadataKey = parsed.values["supadata-key"] ?? process.env.SUPADATA_API_KEY;
  const youtubeKey = parsed.values["youtube-key"] ?? process.env.YOUTUBE_API_KEY;

  if (parsed.values.source === "supadata" && !supadataKey) {
    return {
      error: "--source=supadata requires SUPADATA_API_KEY or --supadata-key\n",
    };
  }

  const opts: ParsedCommon = {
    input: positional,
    json: !!parsed.values.json,
    noMetadata: !!parsed.values["no-metadata"],
    withFrames: !!parsed.values["with-frames"],
  };
  if (sources) opts.sources = sources;
  if (signal) opts.signal = signal;
  if (supadataKey) opts.supadataKey = supadataKey;
  if (youtubeKey) opts.youtubeKey = youtubeKey;
  return opts;
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
    const parsed = parseArgs({ args: argv, options: { json: { type: "boolean" } } });
    json = !!parsed.values.json;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ARG_ERROR;
  }
  const credentials = createFilesystemStore();
  const hostedClient = createHostedClient({ baseUrl: getApiBase(), credentials });
  return writeResult(await runWhoami({ hostedClient }, { json }));
}

async function dispatchTranscript(argv: string[], bareShortcut: boolean): Promise<number> {
  let parsed: ParsedFlags;
  try {
    parsed = parseFlags(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }
  if (parsed.values.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }
  const common = buildCommonOpts(parsed);
  if ("error" in common) {
    process.stderr.write(common.error);
    return EXIT_ARG_ERROR;
  }

  return writeResult(
    await runTranscript(
      { fetchTranscript, fetchMetadata },
      {
        ...common,
        ...(bareShortcut ? { bareShortcut: true } : {}),
        ttyStderr: !!process.stderr.isTTY,
      },
    ),
  );
}

async function dispatchGenerate(argv: string[]): Promise<number> {
  let parsed: ParsedFlags;
  try {
    parsed = parseFlags(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }
  if (parsed.values.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_ARG_ERROR;
  }
  const common = buildCommonOpts(parsed);
  if ("error" in common) {
    process.stderr.write(common.error);
    return EXIT_ARG_ERROR;
  }

  const credentials = createFilesystemStore();
  const hostedClient = createHostedClient({ baseUrl: getApiBase(), credentials });

  const generateOpts: Parameters<typeof runGenerate>[1] = {
    input: common.input,
    json: common.json,
    withFrames: common.withFrames,
  };
  if (common.sources) generateOpts.sources = common.sources;
  if (common.signal) generateOpts.signal = common.signal;
  if (common.supadataKey) generateOpts.supadataKey = common.supadataKey;

  return writeResult(
    await runGenerate(
      {
        fetchTranscript,
        hostedClient,
        progress: (line) => process.stderr.write(`${line}\n`),
      },
      generateOpts,
    ),
  );
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
    case "transcript":
      return dispatchTranscript(argv.slice(1), false);
    case "generate":
      return dispatchGenerate(argv.slice(1));
    default:
      return dispatchTranscript(argv, true);
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
