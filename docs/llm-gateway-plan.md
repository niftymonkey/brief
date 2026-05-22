# LLM Gateway, implementation plan

Implementation plan for #94. Architecture: `docs/architecture/llm-gateway.md`. Tracer-bullet vertical slice in Phase 2; existing-code migration deferred to Phase 4 per project convention. TDD red-green-interleaved within each phase: failing test per module first, confirm RED, then implement.

## Phase 1: Server-side foundation

Lay down the persistent and external surfaces the gateway will compose. Nothing wired to anything yet; each module ships on its own with tests.

- Migration 011: `usage_ledger` table (id, user_id, op, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at; index on (user_id, created_at DESC)).
- **UsageLedger** module: port + Postgres adapter + in-memory adapter for tests. Two methods: `record(call) => ledgerId`, `summarize(userId, since) => { inputTokens, outputTokens, costUsd, calls }`. Lives in `apps/web/src/lib/`.
- **OpenRouterClient** (server-side, internal): one method `generateText({ model, messages, maxOutputTokens }) => { text, usage }`. Two adapters: real (via `@openrouter/ai-sdk-provider`), in-memory for tests.

## Phase 2: First operation end-to-end (`classify`)

Tracer-bullet slice. One operation working start to finish: CLI calls the gateway, server route accepts the request, server-side gateway composes UsageLedger + OpenRouterClient, returns parsed classifier verdict plus server-attested tokens plus ledger row id.

- `LlmGateway` interface in `@brief/core/llm-gateway/port.ts`. Result type: `ClassifyResult = { verdict: "yes" | "no", inputTokens, outputTokens, ledgerId }` plus a typed error union for `auth`, `quota-exceeded`, `rate-limited`, `transient`, `bad-input`.
- Server-side `createServerLlmGateway()` composing UsageLedger + OpenRouterClient.
- Route handler `POST /api/cli/llm/classify` (verify WorkOS bearer, parse multipart {png, json}, dispatch).
- CLI-side `createHttpLlmGateway()` adapter.
- Server-side `CLASSIFIER_PROMPT` constant (mirrors the one in the CLI; CLI still owns its copy until Phase 4).
- Contract test at the public `LlmGateway` interface using in-memory adapters on both sides.

## Phase 3: `describe` and `ask`

Purely additive. Mirrors Phase 2 per operation.

- New methods on `LlmGateway`: `describe(framePath) => VisionDescribeResult`, `ask(input) => AskResult`.
- New route files under `/api/cli/llm/`.
- New server-side prompts: `VISION_PROMPT`, `ASK_SYSTEM_PROMPT`.

## Phase 4: Migrate existing CLI consumers

Per the project convention (migrations-to-existing-code-last), the CLI's vision/classifier/ask code switches over only after the gateway is proven on its own.

- `packages/core/src/frames/vision.ts` collapses to a thin adapter onto `LlmGateway` (or vanishes; orchestrator depends on `LlmGateway` directly).
- `packages/core/src/ask.ts` calls `LlmGateway.ask()`.
- CLI handler reads no `OPENROUTER_API_KEY`; the error path goes away.
- `@openrouter/ai-sdk-provider` removed from the CLI's lockfile (server keeps it).
- FramesMetrics `costSource` becomes `"server-attested"` for new rows. `costSource` literal broadens to enum at this point.

## Phase 5: Pre-flight quota check

Smallest piece, lands last.

- Inside `createServerLlmGateway()`, before dispatching to `OpenRouterClient`.
- Uses `UsageLedger.summarize(userId, dayStart)` against a per-account cap.
- Returns `{ kind: "denied", reason: "quota-exceeded" }`; route maps to 429 with `Retry-After`.

## What Shipped

### Phase 1 (2026-05-22), local

Server-side foundation, no consumer wired yet.

- **Migration 011** (`apps/web/migrations/011_add_usage_ledger.sql`) applied locally; 9 columns verified via `pnpm --filter @brief/web query`. Not yet applied to prod.
- **Migration 012** (`apps/web/migrations/012_add_usage_ledger_checks.sql`) adds non-negativity CHECK constraints on the numeric columns, in response to PR #107 review. Skipped the `op IN (...)` CHECK because the vocabulary is server-controlled and will grow.
- **`apps/web/src/lib/usage-ledger.ts`**: `UsageLedger` port (`record`, `summarize`) + `createInMemoryUsageLedger` (test adapter with `clock` injection and `rows()` inspection) + `createPgUsageLedger` (Postgres adapter via `@vercel/postgres` `sql`). 7 unit tests against the in-memory adapter.
- **`apps/web/src/lib/openrouter-client.ts`**: `OpenRouterClient` port (`generateText`) + `createInMemoryOpenRouterClient` (scripted-response test adapter with `calls()` inspection) + `createOpenRouterClient` (production adapter via `@openrouter/ai-sdk-provider` + Vercel AI SDK). 4 unit tests against the in-memory adapter.
- Web tests: 27 to 38 (+11). Typecheck clean. Production adapters ship without unit tests in line with the rest of `apps/web`; integration confidence lands in Phase 2 when the gateway runs through real Postgres + real OpenRouter.
