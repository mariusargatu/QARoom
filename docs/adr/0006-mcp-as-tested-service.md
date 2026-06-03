# ADR 0006 — MCP server as a first-class tested service

- **Status:** Proposed
- **Date:** 2026-06-02
- **Records:** the decision that, when QARoom builds an MCP server, it is a single **cross-service** server treated as a first-class *tested* QARoom service — realizing the "designed-for-later" MCP seam in `docs/02-architecture.md`. Informed by a May-2026 landscape scan. Does **not** modify any ADR-0001 commitment, and does **not** violate the "no MCP servers *per service* in v1" omission (this is one cross-service server, post-v1). Catalogued as a Milestone-10 candidate.

## Context

The ecosystem ships MCP servers "trust-me": the dominant 2026 testing practice is MCP Inspector click-through plus a handful of unit tests — write-ups titled *"Stop Vibe-Testing Your MCP Server"* and *"Your MCP Server Has No Tests"* are the consensus, not strawmen. Yet the raw material for rigor exists and matches QARoom's stack exactly: every MCP tool ships a JSON Schema 2020-12 input schema and, since spec revision 2025-06-18, an `outputSchema`; the current spec is 2025-11-25 (2026-07-28 in release-candidate). QARoom already emits that dialect from Zod, and `/system/capabilities` already returns operations in MCP-tool-shaped JSON (`llms.txt` advertises it). The seam is in place; this ADR decides what we put through it.

**Honest utility assessment.** Near-term dev-velocity value is **modest**. For a solo developer driving Claude Code, `curl` + the published OpenAPI + `pnpm lint` already cover most of what a read-only MCP surface would offer. The decision is justified on two grounds, neither of which is velocity:

1. **Demonstration.** Rigorously testing the LLM-engineering substrate everyone else ships untested is a sharp, on-thesis artifact for a project whose purpose is to demonstrate testability-as-architecture.
2. **Substrate for the agent milestones.** When autonomous agents (the Milestone 9 moderator; a Milestone 10 agentic-CI demonstration) act on QARoom, they act *through* a tool surface; a tested one is the difference between reliable and trust-me.

Because it does not earn its place on velocity grounds today, the build is **catalogued as a Milestone-10 candidate (post-v1), not pulled forward.** This ADR records the shape so the decision is made once, not re-litigated when the build lands.

## Decision

When built, the MCP server is a single cross-service TypeScript server (`packages/qaroom-mcp`) that reuses `@qaroom/contracts`, `@qaroom/service-kit`, and `@qaroom/testing-utils`, and inherits `eslint-plugin-qaroom` determinism enforcement. It is held to **runtime** determinism (injected `Clock` / `IdGenerator` / `Randomness`), not the script-level latitude an offline tool would get.

**Read-first v1 surface:**

- **Capabilities proxy** — `listTools` / `callTool` generated from `/system/capabilities` (content + gateway). Each tool's `input_schema` *is* the Zod-derived JSON Schema the OpenAPI uses; the tool list is generated from the contract-verified operation registry, never hand-maintained.
- **RFC 7807 tool errors** — tool failures map to the closed `FailureDomain` enum with `retryable` / `next_actions`, via the existing `makeProblem()`, so a calling agent knows whether to retry, back off, or stop.
- **Read resources** — `/system/state`, `/system/limits`, and the frozen `test-results/summary.json`, each validated against its published Zod / frozen schema.
- **Conventions oracle** — a tool returning a typed verdict on whether a diff/snippet satisfies the enforced conventions (wraps `eslint-plugin-qaroom` + the convention checks), callable before writing code.

Mutating `callTool` (createPost / castVote — pulls in `Idempotency-Key` + single-writer) is **deferred** to a second pass.

**The testing contract — four gates essentially nobody applies to MCP servers, all of which QARoom already owns:**

1. **Tool-manifest drift gate** — freeze the generated manifest (tool names + input/output JSON Schemas) and reuse the `openapi-verify` machinery (regenerate-and-diff + `oasdiff` breaking-change classification) so an undeclared tool change fails CI exactly as an `openapi.yaml` break does. A **typed contract**, not a `toMatchSnapshot` blob.
2. **RFC 7807 tool errors** — every tool error path conforms (property-tested with `problemDetailsArb`; asserted with the `expectRFC7807` matcher).
3. **Determinism-trio golden transcripts** — a fixed `callTool` sequence under `setupServiceTest` seeded deps yields a byte-stable transcript.
4. **Property + metamorphic tool I/O** — fast-check over each tool's JSON Schema, plus a Pact-style cross-check of each tool schema against `/system/capabilities` and the published `openapi.yaml`.

Transports: **both** — in-memory (FastMCP-style) for unit/property/golden tests under `setupServiceTest`, HTTP for integration/contract — mirroring the existing `.test` / `.spec` split. In-repo, not registry-published.

## Consequences

### Positive

- The tool surface is auto-fresh from one source of truth: adding a service operation auto-adds the tool; no second registry to maintain.
- Calling agents get structured recovery (`retryable` / `next_actions` / `failure_domain`) instead of opaque error strings.
- All-local, deterministic, no embedding index — fits the determinism discipline and ADR-0004.

### Negative / trade-offs accepted

- A new package and artifact to maintain, justified by demonstration + future-substrate, not present-day velocity (stated above).
- Sensitivity to MCP spec revisions (2025-11-25 → 2026-07-28 RC); the manifest-drift gate is the thing that surfaces a breaking spec/tool change.
- The typed-manifest gate must resist the easy `toMatchSnapshot` path (the snapshot ban is the guardrail).

### Future applications (cross-milestone, recorded here, not built now)

- **Elicitation** as a flattened XState machine + MBT — the Milestone-5 model-based-testing playbook pointed at an MCP interaction surface the ecosystem barely tests.
- **Tool-result prompt-injection** as a named entry in `docs/failure-modes.md` (Milestone 6) with a paired *behavioral* metamorphic assertion — the half static scanners (mcp-scan / MCPTox) cannot do.
- **Judge/prompt-config drift gate** (oasdiff-for-prompts) for the Milestone-9 moderator evals: pin judge model + rubric version, fail CI on an unapproved change; metamorphic relations expressed as fast-check properties; Promptfoo results land as another `runners[]` entry in `summary.json`.

## Rejected alternatives

- **MCP servers per service** — the v1 omission stands; one cross-service server matches how the gateway already fronts content.
- **OpenAPI→MCP generators** (Speakeasy / Stainless / FastMCP) — they wrap endpoints but drop our invariants (OAS `links`, RFC 7807 extensions, examples-per-code); the invariants are the point.
- **Snapshot-based manifest gates** (e.g. Bellwether) — violate the `toMatchSnapshot` ban; ours is a typed contract.
- **RAG / vector-memory MCP for code** — contradicts ADR-0004 (agentic search + LSP, no vector store).
- **MCP Inspector as the test suite** — that *is* the vibe pattern this ADR rejects; Inspector is for manual debugging only.
- **Publishing to the MCP registry now** — premature; in-repo first. `server.json` becomes another contract to drift-gate if/when we publish.

## Related decisions

- `docs/04-roadmap.md` — the Milestone-10 candidate (the tested MCP server + agentic-CI demonstration).
- [ADR-0004](0004-code-intelligence-stack.md) — code-intelligence stack (agentic search + LSP, no RAG); Serena MCP is the code-navigation counterpart this server complements.
- `docs/02-architecture.md` — the "designed-for-later" MCP seam this realizes.
