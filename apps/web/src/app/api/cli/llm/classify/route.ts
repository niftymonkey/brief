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
  // Exhaustive over LlmFailReason; this line forces a TS error if a new
  // reason is added without a corresponding case above.
  const _exhaustive: never = reason;
  return _exhaustive;
}

// Real-world PNG frames from 1080p YouTube source typically run 1-2 MiB with
// a long tail toward 4 MiB on code/text-heavy slides. The previous 2 MiB cap
// failed ~6% of frames on dense videos. 4 MiB clears that tail while staying
// under Vercel's 4.5 MB platform request-body limit (~300 KB headroom for
// multipart framing). Frames above 4 MiB still fail bad-input; per-frame
// resilience in the orchestrator is the long-term fix tracked separately.
// Checked against `frameField.size` before materializing the buffer.
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

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
      { status: 503 },
    );
  }

  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorized("missing-auth");

  // `verifier.verify` reaches out to WorkOS's JWKS endpoint; a network or
  // upstream failure there should surface as a contract-shaped transient
  // error, not a framework 500 that bypasses `{ reason, message }`.
  const verifier = createWorkosTokenVerifier();
  let verified;
  try {
    verified = await verifier.verify(token);
  } catch (err) {
    console.error("[cli/llm/classify] verifier-fault:", err);
    return NextResponse.json(
      errorBody("transient", "auth-service-unavailable"),
      { status: 503 },
    );
  }
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

  // Reject non-PNG before any paid upstream work. Browsers/clients sometimes
  // omit the type; treat empty as "unknown" and accept it (the size + LLM call
  // remain the real protections), but reject any explicit non-PNG.
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

  // Deliberately not forwarding `req.signal`. NextRequest's abort semantics
  // on App Router are unreliable; aborting after the LLM call has started
  // produces real token spend with no audit row (the ledger write is
  // skipped). The 60s timeout inside `createOpenRouterClient` is the bound
  // that matters here; client disconnect does not save us tokens once the
  // upstream call is in flight.
  const result = await gateway.classify({
    userId: verified.userId,
    frame,
  });

  if (result.kind === "ok") {
    return NextResponse.json({
      verdict: result.verdict,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ledgerId: result.ledgerId,
      model: result.model,
    });
  }

  // Server-side logs for failure modes that are signals about our
  // infrastructure, not the CLI caller: bad server credentials (`auth`),
  // upstream rate-limiting (`rate-limited`), and unclassified failures
  // (`transient`). Log the gateway message; redact it from the wire body
  // for `transient` since that path can carry DB or OpenRouter internals.
  if (
    result.reason === "transient" ||
    result.reason === "auth" ||
    result.reason === "rate-limited"
  ) {
    console.error(
      `[cli/llm/classify] ${result.reason} for user ${verified.userId}:`,
      result.message,
    );
  }

  const wireMessage =
    result.reason === "transient" ? "upstream-unavailable" : result.message;

  return NextResponse.json(errorBody(result.reason, wireMessage), {
    status: statusForReason(result.reason),
  });
}
