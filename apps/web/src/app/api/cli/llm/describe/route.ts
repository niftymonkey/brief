import { NextResponse, type NextRequest } from "next/server";
import type { LlmFailReason } from "@brief/core";
import { extractBearer } from "@/lib/cli-auth";
import { createWorkosTokenVerifier } from "@/lib/cli-auth-workos";
import { createServerLlmGateway } from "@/lib/llm-gateway";
import { createOpenRouterClient } from "@/lib/openrouter-client";
import { createPgUsageLedger } from "@/lib/usage-ledger";

/**
 * Server-mediated vision-describe endpoint for the CLI's frames pipeline.
 *
 * Wire shape: `POST /api/cli/llm/describe` with a `multipart/form-data` body
 * containing a `frame` field (PNG bytes). Authenticated via WorkOS bearer.
 * 200 returns `VisionDescribeOkBody`; non-200 returns `LlmErrorBody`. The CLI
 * HTTP adapter lifts (status, body) back into `VisionDescribeResult`.
 *
 * Vision calls are slower than classify (10-30s per frame is common) so the
 * route bumps Vercel's function timeout. The intake route bumped for the
 * same reason; same ceiling chosen for consistency.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

export const maxDuration = 300;

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
  const _exhaustive: never = reason;
  return _exhaustive;
}

const MAX_FRAME_BYTES = 2 * 1024 * 1024;

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
    console.error("[cli/llm/describe] env-misconfig:", err);
    return NextResponse.json(
      errorBody("transient", "server-misconfigured"),
      { status: 503 },
    );
  }

  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorized("missing-auth");

  const verifier = createWorkosTokenVerifier();
  let verified;
  try {
    verified = await verifier.verify(token);
  } catch (err) {
    console.error("[cli/llm/describe] verifier-fault:", err);
    return NextResponse.json(
      errorBody("transient", "auth-service-unavailable"),
      { status: 503 },
    );
  }
  if (verified.kind !== "ok") return unauthorized(verified.kind);

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

  if (frameField.type && frameField.type !== "image/png") {
    return NextResponse.json(
      errorBody(
        "bad-input",
        `'frame' must be image/png (got ${frameField.type})`,
      ),
      { status: 400 },
    );
  }

  if (frameField.size === 0) {
    return NextResponse.json(
      errorBody("bad-input", "'frame' field is empty"),
      { status: 400 },
    );
  }

  if (frameField.size > MAX_FRAME_BYTES) {
    return NextResponse.json(
      errorBody(
        "bad-input",
        `'frame' exceeds ${MAX_FRAME_BYTES}-byte cap`,
      ),
      { status: 400 },
    );
  }

  const frame = Buffer.from(await frameField.arrayBuffer());

  const gateway = createServerLlmGateway({
    ledger: createPgUsageLedger(),
    openrouter: createOpenRouterClient({ apiKey: openRouterKey }),
  });

  // Deliberately not forwarding `req.signal`; same rationale as classify.
  const result = await gateway.describe({
    userId: verified.userId,
    frame,
  });

  if (result.kind === "ok") {
    return NextResponse.json({
      description: result.description,
      mode: result.mode,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ledgerId: result.ledgerId,
      model: result.model,
    });
  }

  if (
    result.reason === "transient" ||
    result.reason === "auth" ||
    result.reason === "rate-limited"
  ) {
    console.error(
      `[cli/llm/describe] ${result.reason} for user ${verified.userId}:`,
      result.message,
    );
  }

  const wireMessage =
    result.reason === "transient" ? "upstream-unavailable" : result.message;

  return NextResponse.json(errorBody(result.reason, wireMessage), {
    status: statusForReason(result.reason),
  });
}
