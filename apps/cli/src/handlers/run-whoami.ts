import type { AuthRequiredReason, HostedClient } from "../hosted-client";
import { EXIT_AUTH_REQUIRED, EXIT_OK, EXIT_TRANSIENT } from "../exit-codes";
import type { HandlerResult } from "./run-login";

function authRequiredMessage(reason: AuthRequiredReason): string {
  switch (reason) {
    case "missing":
      return "Not signed in. Run `brief login`.\n";
    case "expired":
      return "Your session has expired. Run `brief login`.\n";
    case "invalid":
      return "Your credentials weren't accepted by brief (likely a server-side WorkOS config issue). Run `brief login` to retry; if it persists, contact brief support.\n";
    case "revoked":
      return "Your session was revoked. Run `brief login`.\n";
  }
}

export interface RunWhoamiDeps {
  hostedClient: HostedClient;
}

export interface RunWhoamiOptions {
  json: boolean;
}

export async function runWhoami(
  deps: RunWhoamiDeps,
  opts: RunWhoamiOptions,
): Promise<HandlerResult> {
  let result: Awaited<ReturnType<typeof deps.hostedClient.whoami>>;
  try {
    result = await deps.hostedClient.whoami();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: `Server unreachable: ${message}\n`,
      exitCode: EXIT_TRANSIENT,
    };
  }

  switch (result.kind) {
    case "ok":
      if (opts.json) {
        return {
          stdout: `${JSON.stringify({ email: result.email, userId: result.userId })}\n`,
          stderr: "",
          exitCode: EXIT_OK,
        };
      }
      return {
        stdout: `${result.email}\n`,
        stderr: "",
        exitCode: EXIT_OK,
      };
    case "auth-required":
      return {
        stdout: "",
        stderr: authRequiredMessage(result.reason),
        exitCode: EXIT_AUTH_REQUIRED,
      };
    case "transient":
      return {
        stdout: "",
        stderr: `Server unreachable: ${result.message}\n`,
        exitCode: EXIT_TRANSIENT,
      };
  }
}
