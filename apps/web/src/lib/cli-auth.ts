export interface VerifiedUser {
  userId: string;
}

export type TokenVerificationResult =
  | { kind: "ok"; userId: string }
  | { kind: "malformed" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "transient"; cause: string };

export type JwtVerifyFn = (token: string) => Promise<{ payload: { sub?: string } }>;

export interface TokenVerifier {
  verify(token: string): Promise<TokenVerificationResult>;
}

export function extractBearer(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

const INVALID_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JWT_INVALID",
  "ERR_JOSE_NOT_SUPPORTED",
]);

export function createTokenVerifier(jwtVerify: JwtVerifyFn): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token);
        if (!payload.sub) return { kind: "malformed" };
        return { kind: "ok", userId: payload.sub };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ERR_JWT_EXPIRED") return { kind: "expired" };
        if (code && INVALID_CODES.has(code)) return { kind: "invalid" };
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "transient", cause: message };
      }
    },
  };
}
