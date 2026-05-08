import { parseArgs } from "node:util";
import {
  fetchMetadata,
  fetchTranscript,
  type MetadataResult,
  type SourceName,
  type TranscriptResult,
} from "@brief/core";
import { mapExitCode } from "./exit-codes";
import { render, type CombinedResult } from "./renderer";

const USAGE = `Usage: brief <url-or-id> [options]

Fetch a YouTube transcript on stdout.

Options:
  --json                    Emit machine-readable JSON instead of human output
  --no-metadata             Skip the YouTube Data API metadata fetch
  --source=<auto|local|supadata>
                            Override the cascade. Default: auto.
  --timeout=<ms>            Overall request budget in milliseconds
  --supadata-key=<key>      Override SUPADATA_API_KEY env var
  --youtube-key=<key>       Override YOUTUBE_API_KEY env var
  --help                    Show this help

Exit codes:
  0  Transcript retrieved
  1  Argument or unexpected error
  2  Async generation queued (jobId in output)
  3  Permanently unavailable
  4  Transient failure after retries`;

type Parsed = {
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

function parse(argv: string[]): Parsed {
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

async function main(): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n\n${USAGE}\n`);
    return 1;
  }

  if (parsed.values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 1;
  }

  const positional = parsed.positionals[0];
  if (!positional) {
    process.stderr.write(`Missing positional argument <url-or-id>\n\n${USAGE}\n`);
    return 1;
  }

  let sources: SourceName[] | undefined;
  try {
    sources = mapSource(parsed.values.source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    return 1;
  }

  const supadataKey = parsed.values["supadata-key"] ?? process.env.SUPADATA_API_KEY;
  const youtubeKey = parsed.values["youtube-key"] ?? process.env.YOUTUBE_API_KEY;

  if (parsed.values.source === "supadata" && !supadataKey) {
    process.stderr.write(
      `--source=supadata requires SUPADATA_API_KEY or --supadata-key\n`
    );
    return 1;
  }

  let signal: AbortSignal | undefined;
  if (parsed.values.timeout) {
    const ms = Number(parsed.values.timeout);
    if (!Number.isFinite(ms) || ms <= 0) {
      process.stderr.write(`--timeout must be a positive number of ms\n`);
      return 1;
    }
    signal = AbortSignal.timeout(ms);
  }

  const wantMetadata = !parsed.values["no-metadata"] && !!youtubeKey;

  const transcriptPromise: Promise<TranscriptResult> = fetchTranscript(
    positional,
    {
      ...(supadataKey ? { supadataApiKey: supadataKey } : {}),
      ...(sources ? { sources } : {}),
      ...(signal ? { signal } : {}),
    }
  );
  const metadataPromise: Promise<MetadataResult | null> = wantMetadata
    ? fetchMetadata(positional, {
        youtubeApiKey: youtubeKey!,
        ...(signal ? { signal } : {}),
      })
    : Promise.resolve(null);

  const [transcript, metadata] = await Promise.all([
    transcriptPromise,
    metadataPromise,
  ]);

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

main().then(
  (code) => process.exit(code),
  (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Unexpected error: ${msg}\n`);
    process.exit(1);
  }
);
