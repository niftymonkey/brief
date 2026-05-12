import {
  IntakeResponseSchema,
  SchemaMismatchResponseSchema,
  WhoamiResponseSchema,
  type BriefBody,
  type TranscriptSubmission,
  type VideoMetadata,
  type WhoamiResponse,
} from "@brief/core";
import type { CredentialStore, Tokens } from "./credentials";

/**
 * Outcome of asking the auth provider to redeem a refresh token. Matches
 * `RefreshResult` from `./auth` — duplicated here so the hosted client doesn't
 * pull in WorkOS-specific code.
 */
export type RefreshTokensResult =
  | { kind: "ok"; tokens: Tokens }
  | { kind: "expired"; message: string }
  | { kind: "transient"; cause: string; message: string };

export type RefreshTokensFn = (refreshToken: string) => Promise<RefreshTokensResult>;

export interface Transport {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export const defaultTransport: Transport = {
  fetch: (input, init) => globalThis.fetch(input, init),
};

export type AuthRequiredReason = "missing" | "expired" | "invalid" | "revoked";

async function authRequiredReasonFromResponse(res: Response): Promise<AuthRequiredReason> {
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error === "expired") return "expired";
    if (body.error === "invalid") return "invalid";
    if (body.error === "malformed") return "invalid";
    if (body.error === "revoked") return "revoked";
  } catch {
    // fall through to default
  }
  return "expired";
}

export type BriefResult =
  | {
      kind: "ok";
      briefId: string;
      briefUrl: string;
      brief: BriefBody;
      metadata: VideoMetadata;
    }
  | { kind: "auth-required"; reason: AuthRequiredReason }
  | { kind: "schema-mismatch"; serverAccepts: string[]; sent: string }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "transient"; cause: string; message: string };

export type IdentityResult =
  | { kind: "ok"; email: string; userId: string }
  | { kind: "auth-required"; reason: AuthRequiredReason }
  | { kind: "transient"; cause: string; message: string };

export type LogoutResult =
  | { kind: "ok" }
  | { kind: "transient"; cause: string; message: string };

export interface HostedClient {
  submit(submission: TranscriptSubmission): Promise<BriefResult>;
  whoami(): Promise<IdentityResult>;
  logout(): Promise<LogoutResult>;
}

export interface HostedClientOptions {
  baseUrl: string;
  credentials: CredentialStore;
  transport?: Transport;
  /** Per-request timeout for fetch calls. Defaults to 60s to accommodate server-side LLM generation. */
  requestTimeoutMs?: number;
  /**
   * Optional refresh-token redeemer. When supplied, a 401 with reason `expired`
   * triggers exactly one refresh + retry. If refresh itself returns `expired`
   * or `transient`, or no callback is supplied, the original 401 surfaces as
   * `auth-required` to the caller.
   */
  refreshTokens?: RefreshTokensFn;
}

const DEFAULT_RATE_LIMIT_RETRY_SEC = 60;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

function parseRetryAfter(value: string | null): number {
  if (!value) return DEFAULT_RATE_LIMIT_RETRY_SEC;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
    if (diffSec > 0) return diffSec;
  }
  return DEFAULT_RATE_LIMIT_RETRY_SEC;
}

export function createHostedClient(opts: HostedClientOptions): HostedClient {
  const transport = opts.transport ?? defaultTransport;
  const base = opts.baseUrl.replace(/\/$/, "");
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function send(path: string, init: RequestInit, accessToken: string): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set("authorization", `Bearer ${accessToken}`);
    return transport.fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
    });
  }

  async function authorized(
    path: string,
    init: RequestInit,
  ): Promise<{ kind: "no-creds" } | { kind: "response"; res: Response } | { kind: "throw"; err: unknown }> {
    const tokens = await opts.credentials.read();
    if (!tokens) return { kind: "no-creds" };
    try {
      let res = await send(path, init, tokens.accessToken);

      // Reactive refresh: on a 401 caused by an expired access token, redeem
      // the refresh token, persist the new tokens, and retry the request once.
      // Any failure of the refresh path falls through with the original 401.
      if (res.status === 401 && opts.refreshTokens) {
        const reason = await authRequiredReasonFromResponse(res);
        if (reason === "expired") {
          const refreshed = await opts.refreshTokens(tokens.refreshToken);
          if (refreshed.kind === "ok") {
            await opts.credentials.write(refreshed.tokens);
            res = await send(path, init, refreshed.tokens.accessToken);
          }
        }
      }

      return { kind: "response", res };
    } catch (err) {
      return { kind: "throw", err };
    }
  }

  function transientFromThrow(err: unknown): BriefResult & { kind: "transient" } {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "transient", cause: message, message: `Network error: ${message}` };
  }

  function transientFromBody(message: string): BriefResult & { kind: "transient" } {
    return { kind: "transient", cause: "invalid-response", message };
  }

  async function safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  return {
    async submit(submission) {
      const headers = new Headers({ "content-type": "application/json" });
      const call = await authorized("/api/brief/intake", {
        method: "POST",
        headers,
        body: JSON.stringify(submission),
      });
      if (call.kind === "no-creds") return { kind: "auth-required", reason: "missing" };
      if (call.kind === "throw") return transientFromThrow(call.err);
      const res = call.res;

      if (res.status === 401) {
        return { kind: "auth-required", reason: await authRequiredReasonFromResponse(res) };
      }
      if (res.status === 409) {
        const body = await safeJson(res);
        const parsed = SchemaMismatchResponseSchema.safeParse(body);
        return {
          kind: "schema-mismatch",
          serverAccepts: parsed.success ? parsed.data.serverAccepts : [],
          sent: submission.schemaVersion,
        };
      }
      if (res.status === 429) {
        return {
          kind: "rate-limited",
          retryAfterSeconds: parseRetryAfter(res.headers.get("retry-after")),
        };
      }
      if (res.status >= 500) {
        return { kind: "transient", cause: `http-${res.status}`, message: `Server returned ${res.status}` };
      }
      if (!res.ok) {
        return { kind: "transient", cause: `http-${res.status}`, message: `Unexpected status ${res.status}` };
      }

      const body = await safeJson(res);
      const parsed = IntakeResponseSchema.safeParse(body);
      if (!parsed.success) return transientFromBody("Server returned an unrecognized body shape");
      return {
        kind: "ok",
        briefId: parsed.data.briefId,
        briefUrl: parsed.data.briefUrl,
        brief: parsed.data.brief,
        metadata: parsed.data.metadata,
      };
    },

    async whoami() {
      const call = await authorized("/api/cli/whoami", { method: "GET" });
      if (call.kind === "no-creds") return { kind: "auth-required", reason: "missing" };
      if (call.kind === "throw") {
        const message = call.err instanceof Error ? call.err.message : String(call.err);
        return { kind: "transient", cause: message, message: `Network error: ${message}` };
      }
      const res = call.res;
      if (res.status === 401) {
        return { kind: "auth-required", reason: await authRequiredReasonFromResponse(res) };
      }
      if (!res.ok) {
        return { kind: "transient", cause: `http-${res.status}`, message: `Unexpected status ${res.status}` };
      }
      const body = await safeJson(res);
      const parsed = WhoamiResponseSchema.safeParse(body);
      if (!parsed.success) {
        return { kind: "transient", cause: "invalid-response", message: "Server returned an unrecognized identity shape" };
      }
      const result: WhoamiResponse = parsed.data;
      return { kind: "ok", email: result.email, userId: result.userId };
    },

    async logout() {
      const tokens = await opts.credentials.read();
      if (!tokens) return { kind: "ok" };
      const call = await authorized("/api/cli/logout", { method: "POST" });
      if (call.kind === "no-creds") return { kind: "ok" };
      if (call.kind === "throw") {
        const message = call.err instanceof Error ? call.err.message : String(call.err);
        return { kind: "transient", cause: message, message: `Network error: ${message}` };
      }
      const res = call.res;
      if (res.ok || res.status === 401) {
        return { kind: "ok" };
      }
      return { kind: "transient", cause: `http-${res.status}`, message: `Unexpected status ${res.status}` };
    },
  };
}
