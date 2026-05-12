import { NextResponse } from "next/server";

// Public CLI config — unauthenticated, idempotent, cacheable.
// Returns values the brief CLI needs before it can perform login (e.g., the
// WorkOS client_id for the device-flow handshake). WorkOS client_ids are
// public per their docs; this endpoint does not expose secrets.
export async function GET() {
  const workosClientId = process.env.WORKOS_CLIENT_ID;
  if (!workosClientId) {
    console.error("[cli-config] WORKOS_CLIENT_ID is unset; CLI login flows will fail");
    return NextResponse.json({ error: "server-misconfigured" }, { status: 500 });
  }
  return NextResponse.json(
    { workosClientId },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
