import { describe, it, expect } from "vitest";
import {
  createTokenVerifier,
  extractBearer,
  type JwtVerifyFn,
} from "./cli-auth";

describe("extractBearer", () => {
  it("extracts the token from a Bearer prefix", () => {
    expect(extractBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearer("bearer abc")).toBe("abc");
    expect(extractBearer("BEARER abc")).toBe("abc");
  });

  it("returns null for a null header", () => {
    expect(extractBearer(null)).toBe(null);
  });

  it("returns null for an empty header", () => {
    expect(extractBearer("")).toBe(null);
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBe(null);
  });

  it("returns null for a Bearer prefix with no token", () => {
    expect(extractBearer("Bearer ")).toBe(null);
    expect(extractBearer("Bearer")).toBe(null);
  });
});

function jwtError(code: string, message = code): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe("createTokenVerifier", () => {
  it("returns ok with userId when JWT verifies and carries a sub claim", async () => {
    const stub: JwtVerifyFn = async () => ({ payload: { sub: "user_01H" } });
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("any.token.here");
    expect(result).toEqual({ kind: "ok", userId: "user_01H" });
  });

  it("returns malformed when JWT verifies but has no sub claim", async () => {
    const stub: JwtVerifyFn = async () => ({ payload: {} });
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("token");
    expect(result).toEqual({ kind: "malformed" });
  });

  it("returns expired when jose throws ERR_JWT_EXPIRED", async () => {
    const stub: JwtVerifyFn = async () => {
      throw jwtError("ERR_JWT_EXPIRED");
    };
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("token");
    expect(result).toEqual({ kind: "expired" });
  });

  it("returns invalid when jose throws ERR_JWS_SIGNATURE_VERIFICATION_FAILED", async () => {
    const stub: JwtVerifyFn = async () => {
      throw jwtError("ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
    };
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("token");
    expect(result).toEqual({ kind: "invalid" });
  });

  it("returns invalid when jose throws ERR_JWT_CLAIM_VALIDATION_FAILED", async () => {
    const stub: JwtVerifyFn = async () => {
      throw jwtError("ERR_JWT_CLAIM_VALIDATION_FAILED");
    };
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("token");
    expect(result).toEqual({ kind: "invalid" });
  });

  it("returns invalid when jose throws ERR_JWS_INVALID", async () => {
    const stub: JwtVerifyFn = async () => {
      throw jwtError("ERR_JWS_INVALID");
    };
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("not-a-jwt");
    expect(result).toEqual({ kind: "invalid" });
  });

  it("returns transient on unknown errors (e.g., JWKS fetch failure)", async () => {
    const stub: JwtVerifyFn = async () => {
      throw new Error("Connection refused to JWKS endpoint");
    };
    const verifier = createTokenVerifier(stub);
    const result = await verifier.verify("token");
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toMatch(/Connection refused/);
    }
  });
});
