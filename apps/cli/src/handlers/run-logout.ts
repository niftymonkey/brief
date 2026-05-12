import type { HostedClient } from "../hosted-client";
import type { CredentialStore } from "../credentials";
import { EXIT_OK, EXIT_TRANSIENT } from "../exit-codes";
import type { HandlerResult } from "./run-login";

export interface RunLogoutDeps {
  hostedClient: HostedClient;
  credentials: CredentialStore;
}

export async function runLogout(deps: RunLogoutDeps): Promise<HandlerResult> {
  let serverNote = "";
  try {
    const result = await deps.hostedClient.logout();
    if (result.kind === "transient") {
      serverNote = `(Note: server revoke failed: ${result.message}. Local credentials cleared regardless.)\n`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    serverNote = `(Note: server revoke threw: ${message}. Local credentials cleared regardless.)\n`;
  }

  try {
    await deps.credentials.clear();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: `Failed to clear local credentials: ${message}\n`,
      exitCode: EXIT_TRANSIENT,
    };
  }

  return {
    stdout: serverNote ? "Signed out locally.\n" : "Signed out.\n",
    stderr: serverNote,
    exitCode: EXIT_OK,
  };
}
