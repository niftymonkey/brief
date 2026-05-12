import { createRemoteJWKSet, jwtVerify } from "jose";
import { createTokenVerifier, type TokenVerifier } from "./cli-auth";

const WORKOS_API_BASE = "https://api.workos.com";

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (cachedJwks) return cachedJwks;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    throw new Error("WORKOS_CLIENT_ID env var is required for CLI token verification");
  }
  cachedJwks = createRemoteJWKSet(new URL(`${WORKOS_API_BASE}/sso/jwks/${clientId}`));
  return cachedJwks;
}

export function createWorkosTokenVerifier(): TokenVerifier {
  return createTokenVerifier(async (token) => {
    return jwtVerify(token, getJwks());
  });
}

export interface WorkosUserLookupResult {
  email: string;
}

export async function lookupWorkosUserEmail(userId: string): Promise<WorkosUserLookupResult | null> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error("WORKOS_API_KEY env var is required for CLI user lookup");
  }
  const res = await fetch(`${WORKOS_API_BASE}/user_management/users/${userId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { email?: string };
  if (!body.email) return null;
  return { email: body.email };
}
