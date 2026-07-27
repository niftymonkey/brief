interface MessageCarrier {
  message?: unknown;
}

/**
 * Reads a `message` property, keeping it only when it is a string, so the
 * declared `string` return of `errorMessage` holds even for carriers whose
 * `message` is a number, an object or a getter's exotic return value.
 */
function stringMessage(carrier: MessageCarrier): string {
  const { message } = carrier;
  return typeof message === "string" ? message : "";
}

/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * Accepts `Error` instances and any object carrying a string `message`
 * property, which covers the error shapes thrown by SDKs that do not
 * subclass `Error`. Returns an empty string for everything else, so callers
 * can fall back with `errorMessage(err) || <fallback>`.
 *
 * Every read is guarded: prototype lookups, `in` checks and property access
 * all run user code for exotic values (revoked proxies, proxy traps, throwing
 * getters), and this is called from catch blocks where throwing would replace
 * the original failure with an unrelated one. Unreadable values yield `""`.
 */
export function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      return stringMessage(error);
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      return stringMessage(error);
    }
  } catch {
    return "";
  }
  return "";
}
