# @qaroom/qaroom-mcp

The single **cross-service** MCP server, treated as a first-class *tested* QARoom service (ADR-0006, Milestone 10). Read-first v1. No database: the core's only edge is the injected `ServiceClient`.

## Shape

- `src/server/core.ts`: `McpCore`: `listTools` / `callTool` / `listResources` / `readResource`, transport-agnostic, deps-injected (`Clock` + `IdGenerator`). Every outcome is stamped `request_id` + `served_at`.
- `src/registry/`: the tool + resource catalogues, generated from the `content`/`gateway` operation registries. Never hand-maintain the tool list; add a service GET and it appears.
- `src/manifest/`: `buildManifest()` (pure, byte-stable) + `diff.ts` (typed breaking-change classifier). `mcp-manifest.json` is the committed, drift-gated artifact.
- `src/conventions/oracle.ts`: wraps `eslint-plugin-qaroom` via the ESLint `Linter`; returns a typed verdict.
- `src/transport/`: `in-memory.ts` (tests) + `http.ts` (JSON-RPC 2.0 over Fastify). Both satisfy `McpClient`.
- `src/test-support/`: the in-memory harness, schema-driven arbitraries, manifest mutations, and the golden-transcript builder. Not shipped API.

## The four gates (ADR-0006)

1. **Tool-manifest drift**: `pnpm mcp:verify` (regenerate + byte-diff) + the typed breaking-change classifier (`diff.test.ts`). Mirrors `openapi-verify`. No `toMatchSnapshot`.
2. **RFC 7807 tool errors**: `tool-error.property.test.ts` (`problemDetailsArb` + `expectRFC7807`).
3. **Determinism-trio golden transcript**: `golden-transcript.spec.ts`, byte-stable under seeded deps.
4. **Property + metamorphic tool I/O**: `tool-io.property.test.ts`, cross-checked against `/system/capabilities` and the published `openapi.yaml`.

## Conventions

- Edit a tool's shape by editing the **service operation registry**, then `pnpm --filter @qaroom/qaroom-mcp mcp:generate` and commit `mcp-manifest.json`. CI fails on undeclared drift.
- After any behaviour change that alters a tool outcome, regenerate the golden: `tsx src/test-support/write-golden.ts`.
- Mutating `callTool` (createPost / castVote) is deliberately **deferred** to a second pass (pulls in `Idempotency-Key` + single-writer). Do not add it without an ADR amendment.
- Runtime determinism applies: read `clock.now()` / `ids.next()` from `McpDeps`, never globals.
- The HTTP `/mcp` endpoint is **unauthenticated by default** (read-first surface — the same edge-auth-deferred-to-M13 rationale as the gateway REST plane, single-sourced in [ADR-0022](../../docs/adr/0022-gateway-fronts-identity-and-moderation-for-the-web-edge.md) / [`ARCHITECTURE.md` §7](../../ARCHITECTURE.md#7-what-this-architecture-deliberately-omits-and-why)), but supports **opt-in bearer auth** via `QAROOM_MCP_TOKEN` (constant-time check, RFC 7807 401 + `www-authenticate`, `/health` exempt): protect it at the network layer when the token is unset; do not add a mutating tool without auth + an ADR amendment. The conventions oracle caps snippet size (`maxLength` on the tool schema + an in-oracle guard): keep that bound when editing it.

## Commands

```bash
pnpm --filter @qaroom/qaroom-mcp test          # the four gates + transports + oracle
pnpm --filter @qaroom/qaroom-mcp mcp:generate  # regenerate mcp-manifest.json
pnpm mcp:verify                                # drift + breaking-change gate (root)
```
