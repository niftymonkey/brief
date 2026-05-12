import { z } from "zod";
import type { Tokens } from "./credentials";
import { defaultTransport, type Transport } from "./hosted-client";

const DeviceCodeResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number(),
});

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().optional(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
});

const PollErrorSchema = z.object({
  error: z.string(),
});

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_GRANT_TYPE = "refresh_token";
const DEFAULT_EXPIRES_IN_SEC = 5 * 60;
const DEFAULT_WORKOS_BASE = "https://api.workos.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
}

export type AuthFlowResult =
  | { kind: "ok"; tokens: Tokens }
  | { kind: "expired"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "transient"; cause: string; message: string };

/**
 * Outcome of redeeming a refresh token for fresh access/refresh tokens. The
 * `expired` case means the refresh token itself is dead (revoked, expired,
 * or otherwise rejected) — the caller must prompt for a full re-login.
 * `transient` is recoverable on a future call.
 */
export type RefreshResult =
  | { kind: "ok"; tokens: Tokens }
  | { kind: "expired"; message: string }
  | { kind: "transient"; cause: string; message: string };

export interface AuthFlow {
  login(): Promise<AuthFlowResult>;
  refresh(refreshToken: string): Promise<RefreshResult>;
}

export interface AuthFlowOptions {
  clientId: string;
  workosBaseUrl?: string;
  transport?: Transport;
  onCode?: (info: DeviceCodeInfo) => void;
  sleep?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
}

export function createAuthFlow(opts: AuthFlowOptions): AuthFlow {
  const transport = opts.transport ?? defaultTransport;
  const base = (opts.workosBaseUrl ?? DEFAULT_WORKOS_BASE).replace(/\/$/, "");
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  function transientErr(cause: unknown, message: string): AuthFlowResult {
    const causeStr = cause instanceof Error ? cause.message : String(cause);
    return { kind: "transient", cause: causeStr, message };
  }

  async function safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function requestDeviceCode() {
    let res: Response;
    try {
      res = await transport.fetch(`${base}/user_management/authorize/device`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: opts.clientId }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (err) {
      return { kind: "throw" as const, err };
    }
    if (!res.ok) {
      return {
        kind: "http-error" as const,
        status: res.status,
        body: await safeJson(res),
      };
    }
    const parsed = DeviceCodeResponseSchema.safeParse(await safeJson(res));
    if (!parsed.success) return { kind: "malformed" as const };
    return { kind: "ok" as const, data: parsed.data };
  }

  async function pollOnce(deviceCode: string) {
    let res: Response;
    try {
      res = await transport.fetch(`${base}/user_management/authenticate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: DEVICE_GRANT_TYPE,
          client_id: opts.clientId,
          device_code: deviceCode,
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (err) {
      return { kind: "throw" as const, err };
    }
    const body = await safeJson(res);
    if (res.ok) {
      const parsed = TokenResponseSchema.safeParse(body);
      if (!parsed.success) return { kind: "malformed" as const };
      return { kind: "tokens" as const, data: parsed.data };
    }
    if (res.status >= 500) {
      return { kind: "server-error" as const, status: res.status };
    }
    const errParsed = PollErrorSchema.safeParse(body);
    if (!errParsed.success) {
      return { kind: "unknown-client-error" as const, status: res.status };
    }
    return { kind: "oauth-error" as const, error: errParsed.data.error };
  }

  return {
    async login() {
      const device = await requestDeviceCode();
      if (device.kind === "throw") {
        return transientErr(device.err, "Could not start device-code flow");
      }
      if (device.kind === "http-error") {
        return transientErr(
          `http-${device.status}`,
          `WorkOS rejected device-code request (status ${device.status})`,
        );
      }
      if (device.kind === "malformed") {
        return transientErr("malformed-response", "WorkOS returned an unrecognized device-code response");
      }

      const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval } =
        device.data;

      opts.onCode?.({
        userCode: user_code,
        verificationUri: verification_uri,
        verificationUriComplete: verification_uri_complete,
      });

      let currentInterval = interval;
      const deadline = Date.now() + expires_in * 1000;

      while (Date.now() < deadline) {
        await sleep(currentInterval * 1000);

        const poll = await pollOnce(device_code);

        if (poll.kind === "throw") {
          return transientErr(poll.err, "Could not poll WorkOS for tokens");
        }
        if (poll.kind === "server-error") {
          return transientErr(`http-${poll.status}`, `WorkOS returned ${poll.status} during polling`);
        }
        if (poll.kind === "unknown-client-error") {
          return transientErr(`http-${poll.status}`, `WorkOS returned ${poll.status} during polling`);
        }
        if (poll.kind === "malformed") {
          return transientErr("malformed-response", "WorkOS returned an unrecognized token response");
        }
        if (poll.kind === "tokens") {
          const t = poll.data;
          const expiresInSec = t.expires_in ?? DEFAULT_EXPIRES_IN_SEC;
          return {
            kind: "ok",
            tokens: {
              accessToken: t.access_token,
              refreshToken: t.refresh_token,
              expiresAt: Math.floor(Date.now() / 1000) + expiresInSec,
              userId: t.user.id,
              email: t.user.email,
            },
          };
        }

        switch (poll.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            currentInterval = Math.ceil(currentInterval * 1.5);
            break;
          case "expired_token":
            return { kind: "expired", message: "Device code expired before authorization" };
          case "access_denied":
            return { kind: "denied", message: "Authorization was denied" };
          default:
            return transientErr(poll.error, `WorkOS returned unexpected error ${poll.error}`);
        }
      }

      return { kind: "expired", message: "Device code expired before authorization" };
    },

    async refresh(refreshToken) {
      let res: Response;
      try {
        res = await transport.fetch(`${base}/user_management/authenticate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: REFRESH_GRANT_TYPE,
            client_id: opts.clientId,
            refresh_token: refreshToken,
          }),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return { kind: "transient", cause, message: "Could not reach WorkOS to refresh tokens" };
      }
      const body = await safeJson(res);
      if (res.ok) {
        const parsed = TokenResponseSchema.safeParse(body);
        if (!parsed.success) {
          return {
            kind: "transient",
            cause: "malformed-response",
            message: "WorkOS returned an unrecognized refresh response",
          };
        }
        const t = parsed.data;
        const expiresInSec = t.expires_in ?? DEFAULT_EXPIRES_IN_SEC;
        return {
          kind: "ok",
          tokens: {
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + expiresInSec,
            userId: t.user.id,
            email: t.user.email,
          },
        };
      }
      if (res.status >= 500) {
        return {
          kind: "transient",
          cause: `http-${res.status}`,
          message: `WorkOS returned ${res.status} during refresh`,
        };
      }
      // 4xx — treat as a dead refresh token. WorkOS uses `invalid_grant` for
      // revoked/expired refresh tokens; we don't differentiate here because the
      // caller's response is the same in every 4xx case: prompt the user to
      // re-login.
      const errParsed = PollErrorSchema.safeParse(body);
      const reason = errParsed.success ? errParsed.data.error : `http-${res.status}`;
      return { kind: "expired", message: `Refresh token rejected: ${reason}` };
    },
  };
}
