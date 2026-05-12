import type { AuthFlow } from "../auth";
import type { CredentialStore } from "../credentials";
import { EXIT_AUTH_REQUIRED, EXIT_OK, EXIT_TRANSIENT } from "../exit-codes";

export interface HandlerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunLoginDeps {
  authFlow: AuthFlow;
  credentials: CredentialStore;
}

export async function runLogin(deps: RunLoginDeps): Promise<HandlerResult> {
  const result = await deps.authFlow.login();

  switch (result.kind) {
    case "ok":
      await deps.credentials.write(result.tokens);
      return {
        stdout: `Signed in as ${result.tokens.email}\n`,
        stderr: "",
        exitCode: EXIT_OK,
      };
    case "expired":
      return {
        stdout: "",
        stderr: `Login expired: ${result.message}. Try again.\n`,
        exitCode: EXIT_AUTH_REQUIRED,
      };
    case "denied":
      return {
        stdout: "",
        stderr: `Login denied: ${result.message}\n`,
        exitCode: EXIT_AUTH_REQUIRED,
      };
    case "transient":
      return {
        stdout: "",
        stderr: `Login failed (network): ${result.message}\n`,
        exitCode: EXIT_TRANSIENT,
      };
  }
}
