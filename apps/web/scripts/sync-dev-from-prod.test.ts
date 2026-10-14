import { describe, expect, it } from "vitest";
import {
  buildOwnerRemapPlan,
  createNeonClient,
  decideResetSafety,
  endpointIdFromHost,
  executeOwnerRemap,
  isConfirmed,
  NeonApiError,
  parseArgs,
  pickUserIdTables,
  readOwnerRemapIds,
  waitForOperations,
  type FetchLike,
  type NeonBranch,
  type NeonEndpoint,
  type NeonOperation,
  type RemapConnection,
} from "./sync-dev-from-prod";

const DEV_POOLED_URL =
  "postgres://user:pw@ep-ancient-lab-ahh80koz-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DEV_DIRECT_URL =
  "postgres://user:pw@ep-ancient-lab-ahh80koz.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PROD_POOLED_URL =
  "postgres://user:pw@ep-ancient-truth-ah2094of-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

function branch(overrides: Partial<NeonBranch> & { id: string; name: string }): NeonBranch {
  return {
    parentId: null,
    isDefault: false,
    isProtected: false,
    expiresAt: null,
    ...overrides,
  };
}

const MAIN = branch({ id: "br-main", name: "main", isDefault: true });
const DEV = branch({ id: "br-dev", name: "dev", parentId: "br-main" });

const DEV_ENDPOINT: NeonEndpoint = {
  id: "ep-ancient-lab-ahh80koz",
  host: "ep-ancient-lab-ahh80koz.c-3.us-east-1.aws.neon.tech",
  branchId: "br-dev",
  type: "read_write",
};

describe("parseArgs", () => {
  it("treats no arguments as a live run", () => {
    expect(parseArgs([])).toEqual({ ok: true, isDryRun: false });
  });

  it("accepts --dry-run", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ ok: true, isDryRun: true });
  });

  it("refuses a near miss of --dry-run rather than running live", () => {
    const parsed = parseArgs(["--dryrun"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("--dryrun");
  });

  it("refuses an unknown flag even alongside --dry-run", () => {
    expect(parseArgs(["--dry-run", "--prod"]).ok).toBe(false);
  });

  it("refuses a positional argument such as a branch name", () => {
    expect(parseArgs(["staging"]).ok).toBe(false);
  });
});

describe("isConfirmed", () => {
  it("accepts exactly yes and nothing else", () => {
    expect(isConfirmed("yes")).toBe(true);
    expect(isConfirmed("YES")).toBe(false);
    expect(isConfirmed("y")).toBe(false);
    expect(isConfirmed(" yes")).toBe(false);
    expect(isConfirmed("")).toBe(false);
  });
});

describe("endpointIdFromHost", () => {
  it("strips the -pooler suffix from a pooled host", () => {
    expect(endpointIdFromHost("ep-ancient-lab-ahh80koz-pooler.c-3.us-east-1.aws.neon.tech")).toBe(
      "ep-ancient-lab-ahh80koz",
    );
  });

  it("reads the endpoint id from a direct host", () => {
    expect(endpointIdFromHost("ep-ancient-lab-ahh80koz.c-3.us-east-1.aws.neon.tech")).toBe(
      "ep-ancient-lab-ahh80koz",
    );
  });

  it("lowercases the host", () => {
    expect(endpointIdFromHost("EP-Ancient-Lab-AHH80KOZ-Pooler.c-3.us-east-1.aws.neon.tech")).toBe(
      "ep-ancient-lab-ahh80koz",
    );
  });

  it("only strips -pooler at the end of the first label", () => {
    expect(endpointIdFromHost("ep-pooler-thing.example.com")).toBe("ep-pooler-thing");
  });
});

describe("decideResetSafety", () => {
  function decide(
    overrides: { branches?: NeonBranch[]; endpoints?: NeonEndpoint[]; postgresUrl?: string } = {},
  ) {
    return decideResetSafety({
      targetName: "dev",
      branches: overrides.branches ?? [MAIN, DEV],
      endpoints: overrides.endpoints ?? [DEV_ENDPOINT],
      postgresUrl: overrides.postgresUrl ?? DEV_POOLED_URL,
    });
  }

  function refusalOf(decision: ReturnType<typeof decide>): string | null {
    return decision.ok ? null : decision.reason;
  }

  it("approves dev when every check holds, naming target, parent and endpoint", () => {
    const decision = decide();
    expect(decision).toMatchObject({
      ok: true,
      target: DEV,
      parent: MAIN,
      endpoint: DEV_ENDPOINT,
      postgresHost: "ep-ancient-lab-ahh80koz-pooler.c-3.us-east-1.aws.neon.tech",
      warnings: [],
    });
  });

  it("approves a direct (non-pooled) POSTGRES_URL host", () => {
    expect(decide({ postgresUrl: DEV_DIRECT_URL }).ok).toBe(true);
  });

  it("refuses when no branch is named dev", () => {
    expect(refusalOf(decide({ branches: [MAIN] }))).toBe("branch-not-found");
  });

  it("refuses when more than one branch is named dev", () => {
    const twin = branch({ id: "br-dev-2", name: "dev", parentId: "br-main" });
    expect(refusalOf(decide({ branches: [MAIN, DEV, twin] }))).toBe("duplicate-branch-name");
  });

  it("refuses when dev is the default branch", () => {
    const defaultDev = branch({ ...DEV, isDefault: true });
    expect(refusalOf(decide({ branches: [MAIN, defaultDev] }))).toBe("is-default");
  });

  it("refuses when dev is protected", () => {
    const protectedDev = branch({ ...DEV, isProtected: true });
    expect(refusalOf(decide({ branches: [MAIN, protectedDev] }))).toBe("is-protected");
  });

  it("refuses when dev has no parent", () => {
    const rootDev = branch({ ...DEV, parentId: null });
    expect(refusalOf(decide({ branches: [MAIN, rootDev] }))).toBe("no-parent");
  });

  it("refuses when dev's parent is not in the branch list", () => {
    const orphan = branch({ ...DEV, parentId: "br-gone" });
    expect(refusalOf(decide({ branches: [MAIN, orphan] }))).toBe("parent-not-found");
  });

  it("refuses when dev's parent is not the project's default branch", () => {
    const staging = branch({ id: "br-staging", name: "staging", parentId: "br-main" });
    const devFromStaging = branch({ ...DEV, parentId: "br-staging" });
    expect(refusalOf(decide({ branches: [MAIN, staging, devFromStaging] }))).toBe(
      "parent-not-default",
    );
  });

  it("refuses when dev has child branches of its own", () => {
    const child = branch({ id: "br-child", name: "feature", parentId: "br-dev" });
    expect(refusalOf(decide({ branches: [MAIN, DEV, child] }))).toBe("has-children");
  });

  it("refuses when POSTGRES_URL is not a valid URL", () => {
    expect(refusalOf(decide({ postgresUrl: "not a url" }))).toBe("invalid-postgres-url");
  });

  it("refuses when POSTGRES_URL points at production", () => {
    const decision = decide({ postgresUrl: PROD_POOLED_URL });
    expect(refusalOf(decision)).toBe("host-not-on-branch");
    if (!decision.ok) {
      expect(decision.message).toContain("ep-ancient-truth-ah2094of-pooler");
      expect(decision.message).toContain("ep-ancient-lab-ahh80koz");
    }
  });

  it("refuses when dev has no endpoints at all", () => {
    expect(refusalOf(decide({ endpoints: [] }))).toBe("host-not-on-branch");
  });

  it("refuses an endpoint whose id matches but which belongs to another branch", () => {
    const strayEndpoint: NeonEndpoint = { ...DEV_ENDPOINT, branchId: "br-main" };
    expect(refusalOf(decide({ endpoints: [strayEndpoint] }))).toBe("host-not-on-branch");
  });

  it("approves but warns loudly when dev has an expiration set", () => {
    const expiringDev = branch({ ...DEV, expiresAt: "2026-10-20T00:00:00Z" });
    const decision = decide({ branches: [MAIN, expiringDev] });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.warnings).toHaveLength(1);
      expect(decision.warnings[0]).toContain("2026-10-20T00:00:00Z");
    }
  });
});

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fetch that answers from a queue, one response per call, and records what
 * was asked so the test can check the request the client built.
 */
function scriptedFetch(responses: Response[]): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url,
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? init.body : null,
    });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request: ${init.method ?? "GET"} ${url}`);
    return next;
  };
  return { fetch, requests };
}

function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms);
      time += ms;
    },
    slept,
  };
}

const API_BRANCH_MAIN = {
  id: "br-main",
  project_id: "proj-1",
  name: "main",
  default: true,
  protected: false,
  current_state: "ready",
};
const API_BRANCH_DEV = {
  id: "br-dev",
  project_id: "proj-1",
  parent_id: "br-main",
  name: "dev",
  default: false,
  protected: false,
  expires_at: "2026-10-20T00:00:00Z",
  current_state: "ready",
};

function operation(id: string, status: string, action = "create_branch"): Record<string, unknown> {
  return {
    id,
    project_id: "proj-1",
    branch_id: "br-dev",
    action,
    status,
    failures_count: 0,
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-14T00:00:00Z",
    total_duration_ms: 0,
  };
}

describe("createNeonClient", () => {
  it("lists branches with bearer auth and maps them to NeonBranch", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, { branches: [API_BRANCH_MAIN, API_BRANCH_DEV], annotations: {} }),
    ]);
    const clock = fakeClock();
    const client = createNeonClient({ apiKey: "key-123", projectId: "proj-1", fetch, sleep: clock.sleep });

    const branches = await client.listBranches();

    expect(requests[0]?.url).toBe("https://console.neon.tech/api/v2/projects/proj-1/branches");
    expect(requests[0]?.headers.authorization).toBe("Bearer key-123");
    expect(branches).toEqual([
      { id: "br-main", name: "main", parentId: null, isDefault: true, isProtected: false, expiresAt: null },
      {
        id: "br-dev",
        name: "dev",
        parentId: "br-main",
        isDefault: false,
        isProtected: false,
        expiresAt: "2026-10-20T00:00:00Z",
      },
    ]);
  });

  it("follows the pagination cursor until a page carries no next", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, { branches: [API_BRANCH_MAIN], pagination: { next: "cur/1" } }),
      jsonResponse(200, { branches: [API_BRANCH_DEV], pagination: {} }),
    ]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    const branches = await client.listBranches();

    expect(branches.map((b) => b.name)).toEqual(["main", "dev"]);
    expect(requests[1]?.url).toBe(
      "https://console.neon.tech/api/v2/projects/proj-1/branches?cursor=cur%2F1",
    );
  });

  it("stops paginating when a page comes back empty even if it carries a cursor", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, { branches: [API_BRANCH_MAIN], pagination: { next: "a" } }),
      jsonResponse(200, { branches: [], pagination: { next: "b" } }),
    ]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    expect(await client.listBranches()).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("raises NeonApiError carrying the status, code and message of a failed request", async () => {
    const { fetch } = scriptedFetch([
      jsonResponse(401, { code: "UNAUTHORIZED", message: "authentication required" }),
    ]);
    const client = createNeonClient({ apiKey: "bad", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    const error = await client.listBranches().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NeonApiError);
    if (error instanceof NeonApiError) {
      expect(error.status).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.message).toContain("authentication required");
    }
  });

  it("raises NeonApiError when a response does not have the documented shape", async () => {
    const { fetch } = scriptedFetch([jsonResponse(200, { items: [] })]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    const error = await client.listBranches().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NeonApiError);
  });

  it("retries a 423 Locked response with growing waits, then succeeds", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(423, { code: "LOCKED", message: "project is busy" }),
      jsonResponse(423, { code: "LOCKED", message: "project is busy" }),
      jsonResponse(200, { branches: [API_BRANCH_MAIN] }),
    ]);
    const clock = fakeClock();
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: clock.sleep });

    expect(await client.listBranches()).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(clock.slept).toEqual([500, 1000]);
  });

  it("gives up on 423 after the last attempt and reports it", async () => {
    const locked = () => jsonResponse(423, { code: "LOCKED", message: "project is busy" });
    const { fetch, requests } = scriptedFetch([locked(), locked(), locked(), locked(), locked()]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    const error = await client.listBranches().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NeonApiError);
    if (error instanceof NeonApiError) expect(error.status).toBe(423);
    expect(requests).toHaveLength(5);
  });

  it("lists a branch's endpoints and maps them to NeonEndpoint", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, {
        endpoints: [
          {
            id: "ep-ancient-lab-ahh80koz",
            host: "ep-ancient-lab-ahh80koz.c-3.us-east-1.aws.neon.tech",
            branch_id: "br-dev",
            project_id: "proj-1",
            type: "read_write",
            current_state: "idle",
          },
        ],
      }),
    ]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    expect(await client.listBranchEndpoints("br-dev")).toEqual([DEV_ENDPOINT]);
    expect(requests[0]?.url).toBe(
      "https://console.neon.tech/api/v2/projects/proj-1/branches/br-dev/endpoints",
    );
  });

  it("resets from parent by POSTing source_branch_id to restore and returns its operations", async () => {
    const { fetch, requests } = scriptedFetch([
      jsonResponse(200, {
        branch: { ...API_BRANCH_DEV, current_state: "resetting" },
        operations: [operation("op-1", "running", "suspend_compute"), operation("op-2", "scheduling")],
      }),
    ]);
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: fakeClock().sleep });

    const operations = await client.restoreFromParent("br-dev", "br-main");

    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      "https://console.neon.tech/api/v2/projects/proj-1/branches/br-dev/restore",
    );
    expect(requests[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(requests[0]?.body ?? "null")).toEqual({ source_branch_id: "br-main" });
    expect(operations).toEqual([
      { id: "op-1", action: "suspend_compute", status: "running", error: null },
      { id: "op-2", action: "create_branch", status: "scheduling", error: null },
    ]);
  });
});

describe("waitForOperations", () => {
  function setup(responses: Response[]) {
    const { fetch, requests } = scriptedFetch(responses);
    const clock = fakeClock();
    const client = createNeonClient({ apiKey: "k", projectId: "proj-1", fetch, sleep: clock.sleep });
    return { client, requests, clock };
  }

  const options = (clock: ReturnType<typeof fakeClock>) => ({
    timeoutMs: 60_000,
    intervalMs: 5_000,
    sleep: clock.sleep,
    now: clock.now,
  });

  function op(id: string, status: string): NeonOperation {
    return { id, action: "create_branch", status, error: null };
  }

  it("succeeds without polling when every operation already finished or was skipped", async () => {
    const { client, requests, clock } = setup([]);

    const outcome = await waitForOperations(
      client,
      [op("a", "finished"), op("b", "skipped")],
      options(clock),
    );

    expect(outcome.ok).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("polls each unfinished operation until all of them finish", async () => {
    const { client, requests, clock } = setup([
      jsonResponse(200, { operation: operation("a", "running") }),
      jsonResponse(200, { operation: operation("b", "finished") }),
      jsonResponse(200, { operation: operation("a", "finished") }),
    ]);

    const outcome = await waitForOperations(
      client,
      [op("a", "scheduling"), op("b", "running")],
      options(clock),
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.operations.map((o) => o.status)).toEqual(["finished", "finished"]);
    expect(requests.map((r) => r.url)).toEqual([
      "https://console.neon.tech/api/v2/projects/proj-1/operations/a",
      "https://console.neon.tech/api/v2/projects/proj-1/operations/b",
      "https://console.neon.tech/api/v2/projects/proj-1/operations/a",
    ]);
    expect(clock.slept).toEqual([5_000, 5_000]);
  });

  it("treats cancelling as still in progress", async () => {
    const { client, clock } = setup([
      jsonResponse(200, { operation: operation("a", "cancelled") }),
    ]);

    const outcome = await waitForOperations(client, [op("a", "cancelling")], options(clock));

    expect(outcome).toMatchObject({ ok: false, kind: "failed", operation: { status: "cancelled" } });
  });

  it.each(["failed", "error", "cancelled"])(
    "reports the operation that ends in %s, with its error text",
    async (status) => {
      const { client, clock } = setup([
        jsonResponse(200, { operation: { ...operation("a", status), error: "timeline busy" } }),
      ]);

      const outcome = await waitForOperations(client, [op("a", "running")], options(clock));

      expect(outcome).toMatchObject({
        ok: false,
        kind: "failed",
        operation: { id: "a", status, error: "timeline busy" },
      });
    },
  );

  it("reports a failure already present in the initial operations without polling", async () => {
    const { client, requests, clock } = setup([]);

    const outcome = await waitForOperations(
      client,
      [op("a", "finished"), op("b", "error")],
      options(clock),
    );

    expect(outcome).toMatchObject({ ok: false, kind: "failed", operation: { id: "b" } });
    expect(requests).toHaveLength(0);
  });

  it("times out and names the operations still pending", async () => {
    const stillRunning = () => jsonResponse(200, { operation: operation("a", "running") });
    const { client, clock } = setup([stillRunning(), stillRunning(), stillRunning()]);

    const outcome = await waitForOperations(client, [op("a", "running")], {
      timeoutMs: 15_000,
      intervalMs: 5_000,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(outcome).toMatchObject({ ok: false, kind: "timeout", pending: [{ id: "a", status: "running" }] });
    expect(clock.now()).toBe(15_000);
  });
});

const PROD_USER_ID = "user_01KF7XZX6PZ0W4E1ZTYXFQ96RW";
const LOCAL_USER_ID = "user_01KF7N1S7XBZ7J5VB7WKPZYDXE";

describe("readOwnerRemapIds", () => {
  it("reads both ids from the environment", () => {
    expect(
      readOwnerRemapIds({
        DEV_OWNER_PROD_USER_ID: PROD_USER_ID,
        DEV_OWNER_LOCAL_USER_ID: LOCAL_USER_ID,
      }),
    ).toEqual({ ok: true, fromUserId: PROD_USER_ID, toUserId: LOCAL_USER_ID });
  });

  it("trims surrounding whitespace", () => {
    expect(
      readOwnerRemapIds({
        DEV_OWNER_PROD_USER_ID: ` ${PROD_USER_ID} `,
        DEV_OWNER_LOCAL_USER_ID: `${LOCAL_USER_ID}\n`,
      }),
    ).toEqual({ ok: true, fromUserId: PROD_USER_ID, toUserId: LOCAL_USER_ID });
  });

  it.each([
    ["the production id is missing", { DEV_OWNER_LOCAL_USER_ID: LOCAL_USER_ID }, "DEV_OWNER_PROD_USER_ID"],
    ["the local id is missing", { DEV_OWNER_PROD_USER_ID: PROD_USER_ID }, "DEV_OWNER_LOCAL_USER_ID"],
    [
      "the local id is blank",
      { DEV_OWNER_PROD_USER_ID: PROD_USER_ID, DEV_OWNER_LOCAL_USER_ID: "  " },
      "DEV_OWNER_LOCAL_USER_ID",
    ],
  ])("skips, naming the variable, when %s", (_label, env, variable) => {
    const ids = readOwnerRemapIds(env);
    expect(ids.ok).toBe(false);
    if (!ids.ok) expect(ids.skipReason).toContain(variable);
  });

  it("skips when both ids are the same, since there is nothing to move", () => {
    const ids = readOwnerRemapIds({
      DEV_OWNER_PROD_USER_ID: PROD_USER_ID,
      DEV_OWNER_LOCAL_USER_ID: PROD_USER_ID,
    });
    expect(ids.ok).toBe(false);
  });
});

describe("pickUserIdTables", () => {
  it("keeps base tables with a user_id column and drops views, sorted and deduplicated", () => {
    const rows = [
      { table_name: "usage_ledger", table_type: "BASE TABLE" },
      { table_name: "digests", table_type: "BASE TABLE" },
      { table_name: "content_by_user", table_type: "VIEW" },
      { table_name: "tags", table_type: "BASE TABLE" },
      { table_name: "digests_info", table_type: "VIEW" },
      { table_name: "collections", table_type: "BASE TABLE" },
      { table_name: "topics", table_type: "BASE TABLE" },
      { table_name: "digests", table_type: "BASE TABLE" },
    ];

    expect(pickUserIdTables(rows)).toEqual(["collections", "digests", "tags", "topics", "usage_ledger"]);
  });

  it("returns nothing when no base table has a user_id column", () => {
    expect(pickUserIdTables([{ table_name: "digests_info", table_type: "VIEW" }])).toEqual([]);
  });
});

describe("buildOwnerRemapPlan", () => {
  it("builds one parameterised UPDATE per table, moving rows from the prod id to the local id", () => {
    const plan = buildOwnerRemapPlan(["collections", "tags"], {
      fromUserId: PROD_USER_ID,
      toUserId: LOCAL_USER_ID,
    });

    expect(plan).toEqual({
      fromUserId: PROD_USER_ID,
      toUserId: LOCAL_USER_ID,
      statements: [
        {
          table: "collections",
          text: 'UPDATE "collections" SET user_id = $1 WHERE user_id = $2',
          values: [LOCAL_USER_ID, PROD_USER_ID],
        },
        {
          table: "tags",
          text: 'UPDATE "tags" SET user_id = $1 WHERE user_id = $2',
          values: [LOCAL_USER_ID, PROD_USER_ID],
        },
      ],
    });
  });

  it("quotes a table name so it cannot break out of the identifier", () => {
    const plan = buildOwnerRemapPlan(['odd"name'], { fromUserId: "a", toUserId: "b" });
    expect(plan.statements[0]?.text).toBe('UPDATE "odd""name" SET user_id = $1 WHERE user_id = $2');
  });
});

describe("executeOwnerRemap", () => {
  function fakeConnection(rowCounts: Record<string, number>, failOn?: string) {
    const queries: string[] = [];
    let released = false;
    const connection: RemapConnection = {
      query: async (text) => {
        queries.push(text);
        if (failOn && text.includes(failOn)) throw new Error(`boom on ${failOn}`);
        const table = /UPDATE "([^"]+)"/.exec(text)?.[1];
        return { rowCount: table ? (rowCounts[table] ?? 0) : null };
      },
      release: () => {
        released = true;
      },
    };
    return { connection, queries, wasReleased: () => released };
  }

  const plan = () =>
    buildOwnerRemapPlan(["collections", "digests"], {
      fromUserId: PROD_USER_ID,
      toUserId: LOCAL_USER_ID,
    });

  it("runs every UPDATE inside one transaction and reports rows moved per table", async () => {
    const { connection, queries, wasReleased } = fakeConnection({ collections: 3, digests: 41 });

    const moved = await executeOwnerRemap(plan(), connection);

    expect(moved).toEqual([
      { table: "collections", rowCount: 3 },
      { table: "digests", rowCount: 41 },
    ]);
    expect(queries[0]).toBe("BEGIN");
    expect(queries.at(-1)).toBe("COMMIT");
    expect(queries).toHaveLength(4);
    expect(wasReleased()).toBe(true);
  });

  it("rolls back, releases the connection and rethrows when an UPDATE fails", async () => {
    const { connection, queries, wasReleased } = fakeConnection({ collections: 3 }, '"digests"');

    const error = await executeOwnerRemap(plan(), connection).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(wasReleased()).toBe(true);
  });
});
