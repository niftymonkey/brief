import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors";

/** An `Error` subclass whose `message` getter throws instead of returning text. */
class HostileError extends Error {
  override get message(): string {
    throw new Error("message getter exploded");
  }
}

describe("errorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(errorMessage(new Error("upstream exploded"))).toBe("upstream exploded");
  });

  it("returns the message of an Error subclass instance", () => {
    expect(errorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("returns a string message carried by a plain object", () => {
    expect(errorMessage({ message: "sdk failure" })).toBe("sdk failure");
  });

  it("returns an empty string when the message property is not a string", () => {
    expect(errorMessage({ message: 500 })).toBe("");
  });

  it("returns an empty string when an Error carries a non-string message", () => {
    const error = new Error("replaced");
    Object.defineProperty(error, "message", { value: { code: 500 } });

    expect(errorMessage(error)).toBe("");
  });

  it("returns an empty string for values that carry no message", () => {
    expect(errorMessage("boom")).toBe("");
    expect(errorMessage(null)).toBe("");
    expect(errorMessage(undefined)).toBe("");
    expect(errorMessage(7n)).toBe("");
    expect(errorMessage({ status: 500 })).toBe("");
  });

  it("returns an empty string for a revoked proxy instead of throwing", () => {
    const { proxy, revoke } = Proxy.revocable({ message: "gone" }, {});
    revoke();

    expect(() => errorMessage(proxy)).not.toThrow();
    expect(errorMessage(proxy)).toBe("");
  });

  it("returns an empty string when an Error's message getter throws", () => {
    const error = new HostileError();

    expect(() => errorMessage(error)).not.toThrow();
    expect(errorMessage(error)).toBe("");
  });

  it("returns an empty string when a proxy's has trap throws", () => {
    const proxy = new Proxy(
      {},
      {
        has() {
          throw new Error("has trap exploded");
        },
      }
    );

    expect(() => errorMessage(proxy)).not.toThrow();
    expect(errorMessage(proxy)).toBe("");
  });

  it("returns an empty string when a plain object's message getter throws", () => {
    const value = {
      get message(): string {
        throw new Error("get trap exploded");
      },
    };

    expect(() => errorMessage(value)).not.toThrow();
    expect(errorMessage(value)).toBe("");
  });

  it("returns an empty string when a proxy's get trap throws", () => {
    const proxy = new Proxy(
      { message: "unreachable" },
      {
        get() {
          throw new Error("get trap exploded");
        },
      }
    );

    expect(() => errorMessage(proxy)).not.toThrow();
    expect(errorMessage(proxy)).toBe("");
  });
});
