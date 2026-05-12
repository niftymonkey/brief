import { CliConfigResponseSchema, type CliConfigResponse } from "@brief/core";
import { defaultTransport, type Transport } from "./hosted-client";

const DEFAULT_TIMEOUT_MS = 10_000;

export type ServerConfigResult =
  | { kind: "ok"; config: CliConfigResponse }
  | { kind: "transient"; cause: string; message: string };

export interface FetchServerConfigOptions {
  baseUrl: string;
  transport?: Transport;
  timeoutMs?: number;
}

export async function fetchServerConfig(
  opts: FetchServerConfigOptions,
): Promise<ServerConfigResult> {
  const transport = opts.transport ?? defaultTransport;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await transport.fetch(`${base}/api/cli/config`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "transient",
      cause: message,
      message: `Could not reach brief at ${base}: ${message}`,
    };
  }

  if (!res.ok) {
    return {
      kind: "transient",
      cause: `http-${res.status}`,
      message: `brief server returned ${res.status} for CLI config`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "transient",
      cause: "invalid-json",
      message: `brief server returned an invalid CLI config body: ${message}`,
    };
  }

  const parsed = CliConfigResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      kind: "transient",
      cause: "invalid-shape",
      message: "brief server returned a CLI config that doesn't match the expected shape",
    };
  }
  return { kind: "ok", config: parsed.data };
}
