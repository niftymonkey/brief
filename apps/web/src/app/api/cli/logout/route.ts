import { NextResponse, type NextRequest } from "next/server";
import { extractBearer } from "@/lib/cli-auth";

export async function POST(req: NextRequest) {
  const token = extractBearer(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "missing-auth" },
      { status: 401, headers: { "www-authenticate": 'Bearer realm="brief"' } },
    );
  }
  // Best-effort revoke: v1 does not maintain a server-side refresh-token store,
  // so there is nothing to invalidate beyond ack'ing the request. The CLI clears
  // its local credentials regardless of this endpoint's response. A future
  // change can plug in WorkOS session revocation here when it ships.
  return new NextResponse(null, { status: 204 });
}
