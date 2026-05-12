import type { HostedClient } from "../hosted-client";
import { EXIT_AUTH_REQUIRED, EXIT_OK, EXIT_TRANSIENT } from "../exit-codes";
import type { HandlerResult } from "./run-login";

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
  const result = await deps.hostedClient.whoami();

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
        stderr:
          result.reason === "expired"
            ? "Your session has expired. Run `brief login`.\n"
            : "Not signed in. Run `brief login`.\n",
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
