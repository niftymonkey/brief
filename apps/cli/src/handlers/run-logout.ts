import type { HostedClient } from "../hosted-client";
import type { CredentialStore } from "../credentials";
import { EXIT_OK } from "../exit-codes";
import type { HandlerResult } from "./run-login";

export interface RunLogoutDeps {
  hostedClient: HostedClient;
  credentials: CredentialStore;
}

export async function runLogout(deps: RunLogoutDeps): Promise<HandlerResult> {
  const result = await deps.hostedClient.logout();
  await deps.credentials.clear();

  if (result.kind === "transient") {
    return {
      stdout: "Signed out locally.\n",
      stderr: `(Note: server revoke failed: ${result.message}. Local credentials cleared regardless.)\n`,
      exitCode: EXIT_OK,
    };
  }

  return {
    stdout: "Signed out.\n",
    stderr: "",
    exitCode: EXIT_OK,
  };
}
