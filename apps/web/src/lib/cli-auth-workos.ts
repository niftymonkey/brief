import { createRemoteJWKSet, jwtVerify } from "jose";
import { createTokenVerifier, type TokenVerifier } from "./cli-auth";

const WORKOS_API_BASE = "https://api.workos.com";
const WORKOS_ISSUER = "https://api.workos.com";
const USER_LOOKUP_TIMEOUT_MS = 10_000;

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function requireClientId(): string {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    throw new Error("WORKOS_CLIENT_ID env var is required for CLI token verification");
  }
  return clientId;
}

function getJwks() {
  if (cachedJwks) return cachedJwks;
  const clientId = requireClientId();
  cachedJwks = createRemoteJWKSet(new URL(`${WORKOS_API_BASE}/sso/jwks/${clientId}`));
  return cachedJwks;
}

export function createWorkosTokenVerifier(): TokenVerifier {
  return createTokenVerifier(async (token) => {
    return jwtVerify(token, getJwks(), {
      issuer: WORKOS_ISSUER,
      audience: requireClientId(),
    });
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
  const res = await fetch(
    `${WORKOS_API_BASE}/user_management/users/${encodeURIComponent(userId)}`,
    {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(USER_LOOKUP_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`WorkOS user lookup failed with status ${res.status}`);
  }
  const body = (await res.json()) as { email?: string };
  if (!body.email) return null;
  return { email: body.email };
}
