import { NextResponse, type NextRequest } from "next/server";
import { extractBearer } from "@/lib/cli-auth";
import { createWorkosTokenVerifier, lookupWorkosUserEmail } from "@/lib/cli-auth-workos";

function unauthorized(reason: string) {
  return NextResponse.json(
    { error: reason },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="brief"' } },
  );
}

export async function GET(req: NextRequest) {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token) return unauthorized("missing-auth");

  const verifier = createWorkosTokenVerifier();
  const verified = await verifier.verify(token);
  if (verified.kind !== "ok") return unauthorized(verified.kind);

  try {
    const userInfo = await lookupWorkosUserEmail(verified.userId);
    if (!userInfo) {
      console.error(`[whoami] user not found in WorkOS: ${verified.userId}`);
      return NextResponse.json({ error: "user-not-found" }, { status: 503 });
    }
    return NextResponse.json({ userId: verified.userId, email: userInfo.email });
  } catch (err) {
    console.error(`[whoami] lookup failed for ${verified.userId}:`, err);
    return NextResponse.json({ error: "transient" }, { status: 503 });
  }
}
