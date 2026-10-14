#!/usr/bin/env tsx
/**
 * Sync dev from production
 *
 * Resets the Neon branch named `dev` to the current state of its parent, the
 * project's default (production) branch, using Neon's "Reset from parent"
 * (POST /projects/{id}/branches/{id}/restore with the parent as
 * `source_branch_id`). Every row on dev is replaced and no backup is kept.
 *
 * Then moves the owner's rows from his production WorkOS user id to his local
 * one, because WorkOS issues a different id per environment and a fresh copy of
 * production would otherwise show him an empty library locally.
 *
 * Usage: pnpm --filter @brief/web db:sync-from-prod [--dry-run]
 *
 * Reads NEON_API_KEY, NEON_PROJECT_ID and POSTGRES_URL from apps/web/.env, plus
 * the optional DEV_OWNER_PROD_USER_ID and DEV_OWNER_LOCAL_USER_ID. Refuses to
 * touch anything unless the host in POSTGRES_URL is one of dev's own compute
 * endpoints, so the database being reset is always the one local dev uses and
 * never production.
 */

import { config } from "dotenv";
import { sql } from "@vercel/postgres";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { z } from "zod";

const TARGET_BRANCH_NAME = "dev";
const NEON_API_BASE = "https://console.neon.tech/api/v2";
const USAGE = "Usage: pnpm --filter @brief/web db:sync-from-prod [--dry-run]";

/** Neon answers 423 Locked while another operation holds the project; the docs call it safe to retry. */
const MAX_ATTEMPTS = 5;
const FIRST_RETRY_DELAY_MS = 500;
const MAX_BRANCH_PAGES = 50;

/** Neon's operations guide suggests polling every 5 seconds. */
const POLL_INTERVAL_MS = 5_000;
const RESET_TIMEOUT_MS = 5 * 60_000;

/** Terminal statuses as documented in Neon's "Poll operation status" guide. */
const SUCCEEDED_STATUSES = new Set(["finished", "skipped"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled"]);

export type ParsedArgs = { ok: true; isDryRun: boolean } | { ok: false; error: string };

export interface NeonBranch {
  id: string;
  name: string;
  parentId: string | null;
  isDefault: boolean;
  isProtected: boolean;
  expiresAt: string | null;
}

export interface NeonEndpoint {
  id: string;
  host: string;
  branchId: string;
  type: string;
}

export interface NeonOperation {
  id: string;
  action: string;
  status: string;
  error: string | null;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface NeonClient {
  listBranches(): Promise<NeonBranch[]>;
  listBranchEndpoints(branchId: string): Promise<NeonEndpoint[]>;
  restoreFromParent(branchId: string, parentId: string): Promise<NeonOperation[]>;
  getOperation(operationId: string): Promise<NeonOperation>;
}

export interface NeonClientOptions {
  apiKey: string;
  projectId: string;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
}

export class NeonApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null) {
    super(message);
    this.name = "NeonApiError";
    this.status = status;
    this.code = code;
  }
}

export type SafetyRefusalReason =
  | "branch-not-found"
  | "duplicate-branch-name"
  | "is-default"
  | "is-protected"
  | "no-parent"
  | "parent-not-found"
  | "parent-not-default"
  | "has-children"
  | "invalid-postgres-url"
  | "host-not-on-branch";

export interface SafetyInput {
  targetName: string;
  branches: NeonBranch[];
  /** The endpoints Neon lists for the branch named `targetName`. */
  endpoints: NeonEndpoint[];
  postgresUrl: string;
}

export interface SafetyApproved {
  ok: true;
  target: NeonBranch;
  parent: NeonBranch;
  endpoint: NeonEndpoint;
  postgresHost: string;
  warnings: string[];
}

export interface SafetyRefused {
  ok: false;
  reason: SafetyRefusalReason;
  message: string;
}

export type SafetyDecision = SafetyApproved | SafetyRefused;

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export type OperationsOutcome =
  | { ok: true; operations: NeonOperation[] }
  | { ok: false; kind: "failed"; operation: NeonOperation }
  | { ok: false; kind: "timeout"; pending: NeonOperation[] };

export type OwnerRemapIds =
  | { ok: true; fromUserId: string; toUserId: string }
  | { ok: false; skipReason: string };

/** One row of information_schema.columns joined to information_schema.tables. */
export interface UserIdColumnRow {
  table_name: string;
  table_type: string;
}

export interface RemapStatement {
  table: string;
  text: string;
  values: string[];
}

export interface OwnerRemapPlan {
  fromUserId: string;
  toUserId: string;
  statements: RemapStatement[];
}

/** The slice of a pooled Postgres client the remap needs, so tests can stand in for it. */
export interface RemapConnection {
  query(text: string, values?: string[]): Promise<{ rowCount: number | null }>;
  release(): void;
}

export interface RemapResult {
  table: string;
  rowCount: number;
}

/**
 * Reads the command line, refusing anything it does not recognise.
 *
 * The only flag asks the tool NOT to reset, so a near miss like `--dryrun` that
 * was quietly ignored would wipe dev for an operator who asked for the opposite.
 */
export function parseArgs(args: string[]): ParsedArgs {
  let isDryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      isDryRun = true;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}\n${USAGE}` };
  }
  return { ok: true, isDryRun };
}

export function isConfirmed(answer: string): boolean {
  return answer === "yes";
}

/**
 * The hostnames a client can use to reach a Neon endpoint, lowercased: the
 * direct host Neon lists for it, and the pooled form that carries `-pooler` on
 * the first label (`ep-x.c-3...` and `ep-x-pooler.c-3...`).
 */
function connectionHostsOf(endpoint: NeonEndpoint): string[] {
  const direct = endpoint.host.toLowerCase();
  const [firstLabel, ...rest] = direct.split(".");
  const pooled = [`${firstLabel}-pooler`, ...rest].join(".");
  return [direct, pooled];
}

const POSTGRES_PROTOCOLS = ["postgres:", "postgresql:"];

function refuse(reason: SafetyRefusalReason, message: string): SafetyRefused {
  return { ok: false, reason, message };
}

/**
 * Decides whether resetting the target branch from its parent is safe, and
 * names the first check that fails when it is not.
 *
 * The host check is what ties the API's notion of "dev" to the database this
 * machine actually uses: the reset only goes ahead when POSTGRES_URL resolves to
 * one of dev's own endpoints, so a .env pointed at production can never pass.
 */
export function decideResetSafety(input: SafetyInput): SafetyDecision {
  const { targetName, branches, endpoints, postgresUrl } = input;

  const candidates = branches.filter((b) => b.name === targetName);
  if (candidates.length === 0) {
    return refuse("branch-not-found", `No branch named "${targetName}" exists in this project.`);
  }
  if (candidates.length > 1) {
    const ids = candidates.map((b) => b.id).join(", ");
    return refuse(
      "duplicate-branch-name",
      `${candidates.length} branches are named "${targetName}" (${ids}); refusing to guess which one to reset.`,
    );
  }
  const target = candidates[0];

  if (target.isDefault) {
    return refuse(
      "is-default",
      `Branch "${targetName}" (${target.id}) is the project's default branch, which serves production.`,
    );
  }
  if (target.isProtected) {
    return refuse("is-protected", `Branch "${targetName}" (${target.id}) is protected.`);
  }
  if (target.parentId === null) {
    return refuse(
      "no-parent",
      `Branch "${targetName}" (${target.id}) is a root branch with no parent to reset from.`,
    );
  }

  const parent = branches.find((b) => b.id === target.parentId);
  if (!parent) {
    return refuse(
      "parent-not-found",
      `Branch "${targetName}" names parent ${target.parentId}, which is not in the project's branch list.`,
    );
  }
  if (!parent.isDefault) {
    return refuse(
      "parent-not-default",
      `Branch "${targetName}" was made from "${parent.name}" (${parent.id}), not from the project's default branch, so a reset would not copy production.`,
    );
  }

  const children = branches.filter((b) => b.parentId === target.id);
  if (children.length > 0) {
    const names = children.map((b) => `${b.name} (${b.id})`).join(", ");
    return refuse(
      "has-children",
      `Branch "${targetName}" has child branches (${names}); Neon blocks a reset from parent until they are deleted.`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(postgresUrl);
  } catch {
    return refuse("invalid-postgres-url", "POSTGRES_URL in .env is not a valid connection URL.");
  }
  if (!POSTGRES_PROTOCOLS.includes(parsedUrl.protocol)) {
    return refuse(
      "invalid-postgres-url",
      `POSTGRES_URL in .env uses the scheme "${parsedUrl.protocol}"; only ${POSTGRES_PROTOCOLS.map((p) => `"${p}"`).join(" or ")} are accepted.`,
    );
  }
  const postgresHost = parsedUrl.hostname.toLowerCase();
  if (!postgresHost) {
    return refuse("invalid-postgres-url", "POSTGRES_URL in .env has no host.");
  }

  const targetEndpoints = endpoints.filter((e) => e.branchId === target.id);
  const endpoint = targetEndpoints.find((e) => connectionHostsOf(e).includes(postgresHost));
  if (!endpoint) {
    const expected =
      targetEndpoints.length > 0 ? targetEndpoints.flatMap(connectionHostsOf).join(", ") : "none";
    return refuse(
      "host-not-on-branch",
      `POSTGRES_URL in .env points at ${postgresHost}, which is not a host of "${targetName}"'s endpoints (expected one of: ${expected}). Refusing to reset a database local dev does not use.`,
    );
  }

  const warnings: string[] = [];
  if (target.expiresAt !== null) {
    warnings.push(
      `Branch "${targetName}" is set to expire at ${target.expiresAt}; Neon will delete it then. Remove the expiration in the Neon console to keep it.`,
    );
  }

  return { ok: true, target, parent, endpoint, postgresHost, warnings };
}

const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent_id: z.string().nullish(),
  default: z.boolean(),
  protected: z.boolean(),
  expires_at: z.string().nullish(),
});

const branchesPageSchema = z.object({
  branches: z.array(branchSchema),
  pagination: z.object({ next: z.string().nullish() }).nullish(),
});

const endpointsSchema = z.object({
  endpoints: z.array(
    z.object({
      id: z.string(),
      host: z.string(),
      branch_id: z.string(),
      type: z.string(),
    }),
  ),
});

const operationSchema = z.object({
  id: z.string(),
  action: z.string(),
  status: z.string(),
  error: z.string().nullish(),
});

const restoreSchema = z.object({ operations: z.array(operationSchema) });
const operationResponseSchema = z.object({ operation: operationSchema });
const errorBodySchema = z.object({
  code: z.string().nullish(),
  message: z.string().nullish(),
});

function toOperation(raw: z.infer<typeof operationSchema>): NeonOperation {
  return { id: raw.id, action: raw.action, status: raw.status, error: raw.error ?? null };
}

async function errorFromResponse(response: Response, method: string, apiPath: string): Promise<NeonApiError> {
  const text = await response.text().catch(() => "");
  let code: string | null = null;
  let detail = text.trim();
  try {
    const body = errorBodySchema.safeParse(JSON.parse(text));
    if (body.success) {
      code = body.data.code ?? null;
      detail = body.data.message ?? detail;
    }
  } catch {
    // Not JSON: the raw text is the best description available.
  }
  const codePart = code ? ` (${code})` : "";
  return new NeonApiError(
    `Neon API ${method} ${apiPath} failed with HTTP ${response.status}${codePart}: ${detail || response.statusText}`,
    response.status,
    code,
  );
}

/**
 * A minimal client for the four Neon API calls this script makes. Every
 * response is checked against the documented shape before anything reads it,
 * so a changed API fails loudly instead of feeding `undefined` into the safety
 * check.
 */
export function createNeonClient(options: NeonClientOptions): NeonClient {
  const projectPath = `/projects/${encodeURIComponent(options.projectId)}`;

  async function request<T>(
    method: "GET" | "POST",
    apiPath: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${options.apiKey}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    for (let attempt = 1; ; attempt++) {
      const response = await options.fetch(`${NEON_API_BASE}${apiPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.status === 423 && attempt < MAX_ATTEMPTS) {
        await options.sleep(FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      if (!response.ok) throw await errorFromResponse(response, method, apiPath);

      const json: unknown = await response.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new NeonApiError(
          `Neon API ${method} ${apiPath} returned an unexpected shape: ${issues}`,
          response.status,
          null,
        );
      }
      return parsed.data;
    }
  }

  return {
    async listBranches() {
      const branches: NeonBranch[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_BRANCH_PAGES; page++) {
        const query: string = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
        const data: z.infer<typeof branchesPageSchema> = await request(
          "GET",
          `${projectPath}/branches${query}`,
          branchesPageSchema,
        );
        for (const raw of data.branches) {
          branches.push({
            id: raw.id,
            name: raw.name,
            parentId: raw.parent_id ?? null,
            isDefault: raw.default,
            isProtected: raw.protected,
            expiresAt: raw.expires_at ?? null,
          });
        }
        const next = data.pagination?.next ?? null;
        if (next === null || data.branches.length === 0) return branches;
        cursor = next;
      }
      throw new NeonApiError(
        `Neon API kept paginating branches past ${MAX_BRANCH_PAGES} pages; refusing to continue.`,
        null,
        null,
      );
    },

    async listBranchEndpoints(branchId) {
      const data = await request(
        "GET",
        `${projectPath}/branches/${encodeURIComponent(branchId)}/endpoints`,
        endpointsSchema,
      );
      return data.endpoints.map((raw) => ({
        id: raw.id,
        host: raw.host,
        branchId: raw.branch_id,
        type: raw.type,
      }));
    },

    async restoreFromParent(branchId, parentId) {
      const data = await request(
        "POST",
        `${projectPath}/branches/${encodeURIComponent(branchId)}/restore`,
        restoreSchema,
        { source_branch_id: parentId },
      );
      return data.operations.map(toOperation);
    },

    async getOperation(operationId) {
      const data = await request(
        "GET",
        `${projectPath}/operations/${encodeURIComponent(operationId)}`,
        operationResponseSchema,
      );
      return toOperation(data.operation);
    },
  };
}

/**
 * Polls the operations a request started until every one of them reaches a
 * terminal status, stopping at the first failure or at the deadline.
 *
 * An unrecognised status counts as still in progress, so a status Neon adds
 * later can only end in a timeout that names it, never in a false success.
 */
export async function waitForOperations(
  client: Pick<NeonClient, "getOperation">,
  initial: NeonOperation[],
  options: WaitOptions,
): Promise<OperationsOutcome> {
  const deadline = options.now() + options.timeoutMs;
  const operations = [...initial];

  for (;;) {
    const failed = operations.find((op) => FAILED_STATUSES.has(op.status));
    if (failed) return { ok: false, kind: "failed", operation: failed };

    const pending = operations.filter((op) => !SUCCEEDED_STATUSES.has(op.status));
    if (pending.length === 0) return { ok: true, operations };
    if (options.now() >= deadline) return { ok: false, kind: "timeout", pending };

    await options.sleep(options.intervalMs);
    for (const op of pending) {
      const refreshed = await client.getOperation(op.id);
      const index = operations.findIndex((candidate) => candidate.id === op.id);
      operations[index] = refreshed;
    }
  }
}

/**
 * Reads which WorkOS user id to move the owner's rows from and to. A missing id
 * skips the remap rather than failing the run: the reset itself is still useful
 * without it.
 */
export function readOwnerRemapIds(env: Record<string, string | undefined>): OwnerRemapIds {
  const fromUserId = env.DEV_OWNER_PROD_USER_ID?.trim() ?? "";
  const toUserId = env.DEV_OWNER_LOCAL_USER_ID?.trim() ?? "";

  const missing: string[] = [];
  if (!fromUserId) missing.push("DEV_OWNER_PROD_USER_ID");
  if (!toUserId) missing.push("DEV_OWNER_LOCAL_USER_ID");
  if (missing.length > 0) {
    return {
      ok: false,
      skipReason: `${missing.join(" and ")} not set in .env, so the owner's rows stay on the production user id.`,
    };
  }
  if (fromUserId === toUserId) {
    return {
      ok: false,
      skipReason: "DEV_OWNER_PROD_USER_ID and DEV_OWNER_LOCAL_USER_ID are the same id, so there is nothing to move.",
    };
  }
  return { ok: true, fromUserId, toUserId };
}

/**
 * The tables whose rows belong to a user. Views that expose a user_id column
 * are left out: they have no rows of their own, and updating one would either
 * fail or write through to a base table already on the list.
 */
export function pickUserIdTables(rows: UserIdColumnRow[]): string[] {
  const tables = new Set<string>();
  for (const row of rows) {
    if (row.table_type === "BASE TABLE") tables.add(row.table_name);
  }
  return [...tables].sort();
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function buildOwnerRemapPlan(
  tables: string[],
  ids: { fromUserId: string; toUserId: string },
): OwnerRemapPlan {
  return {
    fromUserId: ids.fromUserId,
    toUserId: ids.toUserId,
    statements: tables.map((table) => ({
      table,
      text: `UPDATE ${quoteIdentifier(table)} SET user_id = $1 WHERE user_id = $2`,
      values: [ids.toUserId, ids.fromUserId],
    })),
  };
}

/** Runs the whole remap in one transaction, so a failure leaves no table half moved. */
export async function executeOwnerRemap(
  plan: OwnerRemapPlan,
  connection: RemapConnection,
): Promise<RemapResult[]> {
  try {
    await connection.query("BEGIN");
    const results: RemapResult[] = [];
    for (const statement of plan.statements) {
      const result = await connection.query(statement.text, statement.values);
      results.push({ table: statement.table, rowCount: result.rowCount ?? 0 });
    }
    await connection.query("COMMIT");
    return results;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function readUserIdTables(): Promise<string[]> {
  const result = await sql<UserIdColumnRow>`
    SELECT c.table_name, t.table_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
  `;
  return pickUserIdTables(result.rows);
}

async function promptForYes(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Type 'yes' to confirm: ", (answer) => {
      rl.close();
      resolve(isConfirmed(answer));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeOperation(op: NeonOperation): string {
  const error = op.error ? `: ${op.error}` : "";
  return `${op.action} (${op.id}) is ${op.status}${error}`;
}

function printNextSteps(): void {
  console.log("Next:");
  console.log("  1. pnpm --filter @brief/web inspect-schema");
  console.log("  2. Apply any migration from your current branch that production does not have yet:");
  console.log("     pnpm --filter @brief/web migrate <file>\n");
}

async function runOwnerRemap(ids: { fromUserId: string; toUserId: string }): Promise<void> {
  const tables = await readUserIdTables();
  if (tables.length === 0) {
    console.log("No base table in dev has a user_id column; nothing to move.\n");
    return;
  }
  const plan = buildOwnerRemapPlan(tables, ids);
  const results = await executeOwnerRemap(plan, await sql.connect());
  console.log(`Moved the owner's rows from ${ids.fromUserId} to ${ids.toUserId}:`);
  for (const result of results) {
    console.log(`  ${result.table.padEnd(24)} ${result.rowCount} row(s)`);
  }
  console.log();
}

async function runSync(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`\nError: ${parsed.error}\n`);
    return 1;
  }
  const { isDryRun } = parsed;

  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error(`Error: Environment file not found: ${envPath}`);
    return 1;
  }
  config({ path: envPath });

  const apiKey = process.env.NEON_API_KEY?.trim() ?? "";
  const projectId = process.env.NEON_PROJECT_ID?.trim() ?? "";
  const postgresUrl = process.env.POSTGRES_URL ?? "";
  const missing = [
    apiKey ? null : "NEON_API_KEY",
    projectId ? null : "NEON_PROJECT_ID",
    postgresUrl ? null : "POSTGRES_URL",
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    console.error(`\nError: ${missing.join(", ")} not found in .env`);
    console.error("See apps/web/.env.example for where each one comes from.\n");
    return 1;
  }

  console.log(`\nSync dev from production`);
  console.log(`   Project:     ${projectId}`);
  if (isDryRun) {
    console.log(`   Mode:        DRY RUN (nothing will be reset)`);
  }
  console.log();

  const client = createNeonClient({ apiKey, projectId, fetch, sleep });
  let resetRequested = false;

  try {
    const branches = await client.listBranches();
    const candidates = branches.filter((b) => b.name === TARGET_BRANCH_NAME);
    const endpoints =
      candidates.length === 1 ? await client.listBranchEndpoints(candidates[0].id) : [];

    const decision = decideResetSafety({
      targetName: TARGET_BRANCH_NAME,
      branches,
      endpoints,
      postgresUrl,
    });
    if (!decision.ok) {
      console.error(`Refusing to reset [${decision.reason}]: ${decision.message}\n`);
      return 1;
    }

    for (const warning of decision.warnings) {
      console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.log(`WARNING: ${warning}`);
      console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    }

    const { target, parent, endpoint, postgresHost } = decision;
    console.log(`   Target:      ${target.name} (${target.id})`);
    console.log(`   Parent:      ${parent.name} (${parent.id}), the project's default branch`);
    console.log(`   Dev host:    ${postgresHost} (endpoint ${endpoint.id}, ${endpoint.type})`);
    console.log();
    console.log(`ALL data on "${target.name}" will be replaced by production's current data.`);
    console.log("Anything that exists only on dev is lost. Neon keeps no backup of it.\n");

    const remapIds = readOwnerRemapIds(process.env);
    if (remapIds.ok) {
      console.log(
        `After the reset, the owner's rows move from ${remapIds.fromUserId} to ${remapIds.toUserId}.\n`,
      );
    } else {
      console.log(`Owner remap will be skipped: ${remapIds.skipReason}\n`);
    }

    if (isDryRun) {
      if (remapIds.ok) {
        const tables = await readUserIdTables();
        const plan = buildOwnerRemapPlan(tables, remapIds);
        console.log("Owner remap would run, in one transaction, against dev's tables as they are now");
        console.log("(the live run re-reads them after the reset, so production's schema decides):");
        for (const statement of plan.statements) {
          console.log(`  ${statement.text}   -- $1 = ${remapIds.toUserId}, $2 = ${remapIds.fromUserId}`);
        }
        if (plan.statements.length === 0) console.log("  (no base table has a user_id column)");
        console.log();
      }
      console.log("Dry run complete. Nothing was reset.\n");
      return 0;
    }

    if (!(await promptForYes())) {
      console.log("\nCancelled. Nothing was reset.\n");
      return 0;
    }
    console.log();

    resetRequested = true;
    const operations = await client.restoreFromParent(target.id, parent.id);
    console.log(`Reset requested; waiting on ${operations.length} Neon operation(s)...`);

    const outcome = await waitForOperations(client, operations, {
      timeoutMs: RESET_TIMEOUT_MS,
      intervalMs: POLL_INTERVAL_MS,
      sleep,
      now: Date.now,
    });

    if (!outcome.ok && outcome.kind === "failed") {
      console.error(`\nReset failed: ${describeOperation(outcome.operation)}\n`);
      return 1;
    }
    if (!outcome.ok) {
      console.error(`\nReset did not finish within ${RESET_TIMEOUT_MS / 60_000} minutes. Still pending:`);
      for (const op of outcome.pending) console.error(`  - ${describeOperation(op)}`);
      console.error("Check Monitoring > System operations in the Neon console before re-running.\n");
      return 1;
    }
    console.log(`Reset complete: "${target.name}" now matches "${parent.name}".\n`);

    if (remapIds.ok) {
      try {
        await runOwnerRemap(remapIds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Owner remap failed and was rolled back: ${message}`);
        console.error(
          `Dev was reset, but the owner's rows are still on ${remapIds.fromUserId}. Fix the cause and move them by hand.\n`,
        );
        printNextSteps();
        return 1;
      }
    }

    printNextSteps();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nsync-dev-from-prod failed: ${message}`);
    if (resetRequested) {
      console.error(
        "The reset request was sent, so dev may have been reset anyway. Check the branch in the Neon console.",
      );
    }
    console.error();
    return 1;
  }
}

/**
 * Only the shell invocation runs the sync. Importing this module (its tests do)
 * must never reach the Neon API or a database.
 */
function isDirectInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  runSync().then((code) => process.exit(code));
}
