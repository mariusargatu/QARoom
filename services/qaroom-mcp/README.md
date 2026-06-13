# qaroom-mcp

A tested MCP server for QARoom: the LLM-engineering substrate everyone else ships
trust-me, held to the same gates as every other service (ADR-0006, Milestone 10).

It exposes the `content` + `gateway` read surface as MCP tools, the `/system/*` reads and
`test-results/summary.json` as resources, and a **conventions oracle** that runs
`eslint-plugin-qaroom` over a snippet so an agent can self-check before it writes code.

## Why it exists

The 2026 consensus for testing MCP servers is Inspector click-through plus a few unit
tests. QARoom already owns the machinery to do better, so the server ships with four typed
gates instead:

| Gate | What it proves | Where |
|---|---|---|
| Tool-manifest drift | the committed `mcp-manifest.json` matches the operation registries, and a removed tool / new required input is caught | `pnpm mcp:verify`, `src/manifest/*` |
| RFC 7807 tool errors | every failure is a Problem Details with `failure_domain` / `retryable` / `next_actions` | `src/server/tool-error.property.test.ts` |
| Golden transcript | a fixed call sequence is byte-identical under the seeded determinism trio | `src/server/golden-transcript.spec.ts` |
| Property + metamorphic I/O | inputs that satisfy each tool's JSON Schema are accepted, reads are idempotent, and the manifest matches `/system/capabilities` + `openapi.yaml` | `src/server/tool-io.property.test.ts` |

None of the gates use `toMatchSnapshot`: each is a typed contract.

## Architecture

```
McpCore (no DB, deps-injected)
  ├── ServiceClient   ── http (fetch) | fixture (tests)
  ├── SummaryProvider ── reads + validates test-results/summary.json
  └── ConventionsOracle ── ESLint Linter over eslint-plugin-qaroom
Transports
  ├── in-memory  (direct core calls)        -> unit / property / golden
  └── http       (JSON-RPC 2.0 over Fastify) -> integration / contract
```

The core is transport-agnostic; the official MCP SDK is intentionally not a dependency
(the JSON-RPC wire is hand-rolled over the existing Fastify dep), so the SDK can be
swapped in without touching the core or the gates.

## Run it

```bash
pnpm --filter @qaroom/qaroom-mcp test     # the gates
pnpm --filter @qaroom/qaroom-mcp dev      # HTTP transport on :8090 (proxies the live services)
```
