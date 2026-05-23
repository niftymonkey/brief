import { NextResponse, type NextRequest } from "next/server";
import type { LlmFailReason } from "@brief/core";
import { extractBearer } from "@/lib/cli-auth";
import { createWorkosTokenVerifier } from "@/lib/cli-auth-workos";
import { createServerLlmGateway } from "@/lib/llm-gateway";
import { createOpenRouterClient } from "@/lib/openrouter-client";
import { createPgUsageLedger } from "@/lib/usage-ledger";

/**
 * Server-mediated classify endpoint for the CLI's frames pipeline.
 *
 * Wire shape: `POST /api/cli/llm/classify` with a `multipart/form-data` body
 * containing a `frame` field (PNG bytes). Authenticated via WorkOS bearer.
 * 200 returns `ClassifyOkBody`; non-200 returns `LlmErrorBody`. The CLI HTTP
 * adapter (Phase 2 follow-up) lifts (status, body) back into `ClassifyResult`.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

function errorBody(reason: LlmFailReason, message: string) {
  return { reason, message };
}

function unauthorized(reason: string) {
  return NextResponse.json(errorBody("auth", reason), {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="brief"' },
  });
}

function statusForReason(reason: LlmFailReason): number {
  switch (reason) {
    case "auth":
      return 401;
    case "quota-exceeded":
    case "rate-limited":
      return 429;
    case "bad-input":
      return 400;
    case "transient":
      return 503;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  let openRouterKey: string;
  try {
    openRouterKey = requireEnv("OPENROUTER_API_KEY");
  } catch (err) {
    console.error("[cli/llm/classify] env-misconfig:", err);
    return NextResponse.json(
      errorBody("transient", "server-misconfigured"),
      { status: 500 },
    );
  }

  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorized("missing-auth");

  const verifier = createWorkosTokenVerifier();
  const verified = await verifier.verify(token);
  if (verified.kind !== "ok") return unauthorized(verified.kind);

  // Multipart parsing. The CLI sends the PNG bytes under a `frame` field.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      errorBody("bad-input", "expected multipart/form-data body"),
      { status: 400 },
    );
  }

  const frameField = form.get("frame");
  if (!(frameField instanceof File)) {
    return NextResponse.json(
      errorBody("bad-input", "missing 'frame' file field"),
      { status: 400 },
    );
  }

  const frame = Buffer.from(await frameField.arrayBuffer());
  if (frame.length === 0) {
    return NextResponse.json(
      errorBody("bad-input", "'frame' field is empty"),
      { status: 400 },
    );
  }

  const gateway = createServerLlmGateway({
    ledger: createPgUsageLedger(),
    openrouter: createOpenRouterClient({ apiKey: openRouterKey }),
  });

  const result = await gateway.classify({
    userId: verified.userId,
    frame,
    signal: req.signal,
  });

  if (result.kind === "ok") {
    return NextResponse.json({
      verdict: result.verdict,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ledgerId: result.ledgerId,
    });
  }

  // Log transient failures server-side so on-call has the OpenRouter or
  // ledger error message even though the CLI only sees the wire reason.
  if (result.reason === "transient") {
    console.error(
      `[cli/llm/classify] transient for user ${verified.userId}:`,
      result.message,
    );
  }

  return NextResponse.json(errorBody(result.reason, result.message), {
    status: statusForReason(result.reason),
  });
}
