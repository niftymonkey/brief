import { parseArgs } from "node:util";
import { fetchMetadata, fetchTranscript, type SourceName } from "@brief/core";
import { createAuthFlow, type AuthFlow } from "./auth";
import { createFilesystemStore } from "./credentials";
import { EXIT_ARG_ERROR, EXIT_TRANSIENT } from "./exit-codes";
import { createHostedClient, type RefreshTokensFn } from "./hosted-client";
import { runGenerate } from "./handlers/run-generate";
import { runLogin } from "./handlers/run-login";
import { runLogout } from "./handlers/run-logout";
import { runTranscript } from "./handlers/run-transcript";
import { runWhoami } from "./handlers/run-whoami";
import { fetchServerConfig } from "./server-config";

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
  --with-frames                            (transcript, generate) Augment output with on-screen content captured from video frames.
                                           For \`transcript --with-frames\`, prints the augmented transcript (with [VISUAL] markers) to stdout
                                           — pipe-friendly. For \`generate --with-frames\`, ships the augmented transcript to the server so
                                           the brief picks up on-screen content. Requires yt-dlp + ffmpeg on PATH and OPENROUTER_API_KEY
                                           (or --openrouter-key). Adds 1–3 min runtime per video on first run; cached locally for re-runs.
  --source=<auto|local|supadata>           Override the transcript cascade
  --timeout=<ms>                           Overall request budget
  --supadata-key=<key>                     Override SUPADATA_API_KEY env var
  --youtube-key=<key>                      (transcript) Override YOUTUBE_API_KEY env var
  --openrouter-key=<key>                   (with --with-frames) Override OPENROUTER_API_KEY env var
  --help                                   Show this help

Environment:
  BRIEF_API_URL                            Hosted brief service URL (default: ${DEFAULT_API_BASE})
  WORKOS_CLIENT_ID                         WorkOS client ID override (CLI fetches the value from the server by default)
  OPENROUTER_API_KEY                       Required when --with-frames is set (your own OpenRouter key)

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
    "openrouter-key"?: string;
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
      "openrouter-key": { type: "string" },
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

/**
 * Builds a refresh-token redeemer that lazily resolves the WorkOS client ID
 * the first time a refresh is actually needed. Most CLI calls succeed without
 * touching this path, so the env-or-server-config lookup is deferred until a
 * 401-expired triggers it.
 */
function makeRefreshTokens(): RefreshTokensFn {
  let cachedFlow: AuthFlow | null = null;
  return async (refreshToken: string) => {
    if (!cachedFlow) {
      let clientId = process.env.WORKOS_CLIENT_ID;
      if (!clientId) {
        const config = await fetchServerConfig({ baseUrl: getApiBase() });
        if (config.kind !== "ok") {
          return {
            kind: "transient",
            cause: config.message,
            message: `Could not resolve WorkOS client ID for token refresh: ${config.message}`,
          };
        }
        clientId = config.config.workosClientId;
      }
      cachedFlow = createAuthFlow({ clientId });
    }
    return cachedFlow.refresh(refreshToken);
  };
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
  openRouterKey?: string;
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
  const openRouterKey = parsed.values["openrouter-key"] ?? process.env.OPENROUTER_API_KEY;

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
  if (openRouterKey) opts.openRouterKey = openRouterKey;
  return opts;
}

async function dispatchLogin(): Promise<number> {
  let clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    const config = await fetchServerConfig({ baseUrl: getApiBase() });
    if (config.kind !== "ok") {
      process.stderr.write(`${config.message}\n`);
      return EXIT_TRANSIENT;
    }
    clientId = config.config.workosClientId;
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
  const hostedClient = createHostedClient({
    baseUrl: getApiBase(),
    credentials,
    refreshTokens: makeRefreshTokens(),
  });
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
  const hostedClient = createHostedClient({
    baseUrl: getApiBase(),
    credentials,
    refreshTokens: makeRefreshTokens(),
  });
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
    return 0;
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
    return 0;
  }
  const common = buildCommonOpts(parsed);
  if ("error" in common) {
    process.stderr.write(common.error);
    return EXIT_ARG_ERROR;
  }

  const credentials = createFilesystemStore();
  const hostedClient = createHostedClient({
    baseUrl: getApiBase(),
    credentials,
    refreshTokens: makeRefreshTokens(),
  });

  const generateOpts: Parameters<typeof runGenerate>[1] = {
    input: common.input,
    json: common.json,
    withFrames: common.withFrames,
  };
  if (common.sources) generateOpts.sources = common.sources;
  if (common.signal) generateOpts.signal = common.signal;
  if (common.supadataKey) generateOpts.supadataKey = common.supadataKey;
  if (common.openRouterKey) generateOpts.openRouterKey = common.openRouterKey;

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
