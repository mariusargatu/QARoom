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

## Connect an agent

The HTTP transport is a single JSON-RPC 2.0 endpoint — `POST /mcp` — speaking the MCP method names
(`tools/list`, `tools/call`, `resources/list`, `resources/read`). `/health` stays open; set
`QAROOM_MCP_TOKEN` to require `Authorization: Bearer <token>` on `/mcp` (unset = open, for a
network-protected in-cluster deploy).

```bash
pnpm --filter @qaroom/qaroom-mcp dev      # serves on http://localhost:8090

# list the tools
curl -s localhost:8090/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# call one (community_id is fixed position 3 in every read)
curl -s localhost:8090/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"content_getPost","arguments":{"community_id":"comm_…","id":"post_…"}}}'
```

The read surface (full input/output schemas live in the drift-gated [`mcp-manifest.json`](mcp-manifest.json), pinned by `pnpm mcp:verify`):

| Group | Tools |
|---|---|
| `content` (direct) | `content_getPost`, `content_listCommunityFeed` |
| `gateway` (cross-service reads) | `gateway_getPost`, `gateway_getUser`, `gateway_getDonation`, `gateway_listDonations`, `gateway_getModerationDecision`, `gateway_listModerationDecisions`, `gateway_getWebhook`, `gateway_listWebhooks`, `gateway_listWebhookDeliveries`, `gateway_listCommunityFeed`, `gateway_listEvents`, `gateway_listFlags`, `gateway_resolveFlag`, `gateway_listMembers` |
| conventions oracle | `qaroom_conventionsCheck` (lints a snippet through `eslint-plugin-qaroom`) |

> **Not yet a drop-in `claude mcp add`.** This is a hand-rolled JSON-RPC surface using the MCP method
> names, not the full Streamable-HTTP transport, and there is no stdio entrypoint. A spec MCP client
> (Claude Desktop, `claude mcp add`) needs a thin stdio↔HTTP shim — deferred alongside the mutating
> `callTool` pass (ADR-0006). The core is transport-agnostic, so that shim adds no risk to the gates.
