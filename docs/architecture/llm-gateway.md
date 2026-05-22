# LLM access for CLI work

How brief mediates LLM calls that originate in the CLI's frames and ask pipelines. Companion to `docs/architecture/cli-thin-client.md` (#88) and `docs/architecture/video-frames.md` (#87). Closes the loop on #94.

## Background

The CLI was designed in #88 as a thin client: it does work that needs residential-IP egress (downloading YouTube and extracting frames), then submits results to brief's hosted service for persistence and brief generation. #87 shipped that pipeline with one constraint we deferred: the vision and classifier LLM calls run locally against the user's own OpenRouter key.

That deferred constraint had two consequences. LLM costs from CLI work were paid by the user directly, were invisible to brief's accounting, and could not be subject to per-account quota or verification. And the onboarding promise of "sign in once with `brief login` and nothing else" was broken by a required `OPENROUTER_API_KEY` env var.

## What we evaluated

Two candidate paths.

**Token-issuance.** Brief's server mints short-lived OpenRouter API keys scoped to the authenticated user. The CLI uses these keys to call OpenRouter directly. Server records spend after the fact by reconciling against OpenRouter's billing endpoint.

**Server-proxy.** The CLI calls a typed endpoint on brief's server. Brief's server makes the OpenRouter call, observes the response, writes a usage row inline, and returns the result to the CLI.

We explored interface shape inside each path through four parallel design passes, each constrained to a different priority: minimize the interface, maximize flexibility, optimize for the common caller, strict ports-and-adapters. All four independently selected server-proxy.

We also consulted the tool-radar catalogue (Arcjet, Unkey) for vendor coverage. Neither owns the full problem cleanly: Arcjet is a strong fit for the quota-enforcement half if we want to revisit later, Unkey is redundant alongside WorkOS for authenticated access. No vendor in the catalogue covers the LLM-gateway product class itself, so this is a build call.

## Decision

**Server-proxy, with typed-operation methods on the gateway.**

The CLI calls `classify(frame)`, `describe(frame)`, and `ask(input)`. Each returns a parsed domain result plus server-attested token counts plus a ledger row id. Prompts, model selection, and response parsing live server-side. The category-4 OpenRouter seam lives inside the server's gateway implementation; the CLI never sees it.

## Why

- **Server-attested attribution from the first call.** Token counts come from the OpenRouter response the server itself observed. No reconciliation seam, no eventual-consistency window.
- **Server-owned prompts and models.** Classifier and vision prompts (today living in the CLI as constants) move server-side. Prompt iteration and model upgrades no longer require a CLI release.
- **Pre-flight quota enforcement is exact, not approximate.** The server holds the ledger and can refuse a call before spending tokens.
- **Fewer modules.** No AccessGrant, no AccessIssuer, no Provisioning-API wrapper, no async reconciliation job. The WorkOS bearer already authenticates the user; that is the only credential the call needs.
- **One LLM seam inside brief.** Future consumers (the Chrome extension, a possible MCP server, ad-hoc tools) share the same gateway, the same ledger, the same quota.

## What we gave up

One extra server hop per LLM call. The user's frame bytes leave their machine the same way they do today (CLI to a cloud endpoint); now they travel CLI to brief to OpenRouter instead of CLI to OpenRouter. The brief-to-OpenRouter leg is datacenter-to-datacenter and runs roughly 50 to 200 ms per call. Across a typical run with the existing concurrency (5 classifier, 4 vision), this adds single-digit seconds to a 1 to 3 minute baseline.

## Shape (at the module level)

- **LlmGateway.** External port. Methods typed by operation (`classify`, `describe`, `ask`). Two adapters: production HTTP, in-memory for tests. Lives in `@brief/core` (or a new `@brief/llm-gateway` package) so both CLI and server share types.
- **UsageLedger.** Internal port inside the server-side gateway implementation. Postgres-backed, with an in-memory adapter for tests. Not exposed through the gateway's external interface; callers can never write to it directly.
- **OpenRouterClient.** Internal port. Two adapters: real OpenRouter via the AI SDK provider, in-memory for server-side tests.
- **Route handlers.** Thin per-operation routes under `/api/cli/llm/<op>`. Verify bearer, dispatch to in-process gateway.

## Why not token-issuance

A server-trusted token count requires the server to observe the call. A scoped OpenRouter key does the opposite: it hands the call to a credential the CLI uses outside the server's view, then asks us to reconcile after the fact against OpenRouter's billing aggregates. That introduces lag, depends on a vendor surface we do not control, and cannot enforce server-side policy (model allowlist, prompt template, output-token ceiling) on the key in flight. The simpler implementation is also the one with better attribution semantics. Latency is the only column where token-issuance would have won, and even that win is small.

## Cross-references

- `docs/architecture/cli-thin-client.md`: the thin-client architecture this slots into.
- `docs/architecture/video-frames.md`: the pipeline whose LLM calls this gateway mediates.
- `docs/youtube-tos-research.md`: why frame extraction has to run locally in the first place.
- GitHub epic: #94.
