import {
  ClassifyOkBodySchema,
  LlmErrorBodySchema,
  VisionDescribeOkBodySchema,
  type LlmFailReason,
  type LlmGatewayClient,
} from "@brief/core";
import type { CredentialStore } from "./credentials";
import type { RefreshTokensFn, Transport } from "./hosted-client";

export type { LlmGatewayClient };

export interface LlmGatewayClientOptions {
  baseUrl: string;
  credentials: CredentialStore;
  transport?: Transport;
  /**
   * Optional refresh-token redeemer. When supplied, a 401 the server tagged
   * `expired` (via `body.reason === "auth"` + `body.message === "expired"`)
   * triggers exactly one refresh + retry. Without it, the original 401
   * surfaces as `kind: "failed" reason: "auth"`.
   */
  refreshTokens?: RefreshTokensFn;
}

const defaultTransport: Transport = {
  fetch: (input, init) => globalThis.fetch(input, init),
};

export function createLlmGatewayClient(
  opts: LlmGatewayClientOptions,
): LlmGatewayClient {
  const transport = opts.transport ?? defaultTransport;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function send(path: string, frame: Buffer, bearer: string): Promise<Response> {
    const body = new FormData();
    body.append("frame", new Blob([new Uint8Array(frame)], { type: "image/png" }), "frame.png");
    return transport.fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
      body,
    });
  }

  async function post(
    path: string,
    frame: Buffer,
  ): Promise<
    | { kind: "ok"; res: Response }
    | { kind: "no-creds" }
    | { kind: "throw"; err: unknown }
  > {
    const tokens = await opts.credentials.read();
    if (!tokens) return { kind: "no-creds" };
    try {
      let res = await send(path, frame, tokens.accessToken);
      if (res.status === 401 && opts.refreshTokens && (await isExpiredSignal(res))) {
        const refreshed = await opts.refreshTokens(tokens.refreshToken);
        if (refreshed.kind === "ok") {
          await opts.credentials.write(refreshed.tokens);
          res = await send(path, frame, refreshed.tokens.accessToken);
        }
      }
      return { kind: "ok", res };
    } catch (err) {
      return { kind: "throw", err };
    }
  }

  return {
    async classify(frame) {
      const out = await post("/api/cli/llm/classify", frame);
      if (out.kind === "no-creds") return failure("auth", "missing-credentials");
      if (out.kind === "throw") return failure("transient", errMessage(out.err));
      if (!out.res.ok) return await liftError(out.res);
      const parsed = ClassifyOkBodySchema.safeParse(await safeJson(out.res));
      if (!parsed.success) return failure("transient", "malformed-ok-body");
      return {
        kind: "ok",
        verdict: parsed.data.verdict,
        inputTokens: parsed.data.inputTokens,
        outputTokens: parsed.data.outputTokens,
        ledgerId: parsed.data.ledgerId,
        model: parsed.data.model,
      };
    },
    async describe(frame) {
      const out = await post("/api/cli/llm/describe", frame);
      if (out.kind === "no-creds") return failure("auth", "missing-credentials");
      if (out.kind === "throw") return failure("transient", errMessage(out.err));
      if (!out.res.ok) return await liftError(out.res);
      const parsed = VisionDescribeOkBodySchema.safeParse(await safeJson(out.res));
      if (!parsed.success) return failure("transient", "malformed-ok-body");
      return {
        kind: "ok",
        description: parsed.data.description,
        mode: parsed.data.mode,
        inputTokens: parsed.data.inputTokens,
        outputTokens: parsed.data.outputTokens,
        ledgerId: parsed.data.ledgerId,
        model: parsed.data.model,
      };
    },
  };
}

function failure(reason: LlmFailReason, message: string): { kind: "failed"; reason: LlmFailReason; message: string } {
  return { kind: "failed", reason, message };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function liftError(res: Response): Promise<{ kind: "failed"; reason: LlmFailReason; message: string }> {
  const json = await res.clone().json().catch(() => null);
  const parsed = LlmErrorBodySchema.safeParse(json);
  if (parsed.success) {
    return failure(parsed.data.reason, parsed.data.message);
  }
  return failure("transient", `http-${res.status}`);
}

async function isExpiredSignal(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { reason?: string; message?: string };
    return body.reason === "auth" && body.message === "expired";
  } catch {
    return false;
  }
}
