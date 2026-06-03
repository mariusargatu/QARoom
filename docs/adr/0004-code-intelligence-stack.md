# ADR 0004 — Code-intelligence stack and scale triggers

- **Status:** Accepted
- **Date:** 2026-05-29
- **Records:** how the coding agent comprehends this codebase, and the ladder for scaling that comprehension as QARoom grows. A Milestone 1 implementation choice that realizes the "agent-hospitable substrate" principle (docs/01-vision). It does **not** modify any ADR-0001 commitment.

## Context

An LLM coding agent needs to find, understand, and safely edit code. The options form a spectrum: static orientation files, live agentic search (grep/glob/read), LSP/structural precision, whole-repo repo-maps, code knowledge graphs, and embedding/RAG indexes or SCIP code graphs.

The 2025-2026 evidence is clear for *source code* specifically: agentic search beats a precomputed RAG/vector index. Anthropic built RAG + a local vector DB into early Claude Code, A/B-tested it, and dropped it (agentic search "outperformed by a lot"); an Amazon Science result ("Keyword search is all you need", 2026) found agentic keyword search reaches >90% of RAG performance with no vector DB. Indexes go stale on every edit, chunking destroys code structure, embeddings trade exactness for fuzzy recall, and they leak code to embedding APIs. Static orientation files and live search are complementary, not competing: files carry the *why*, search finds the *what*.

QARoom is small (~4k LOC, 2 services) and grows toward ~10 services. Adopting heavyweight retrieval now would be complexity that has not earned its place.

## Decision

A layered stack, adopted by size and cross-service coupling, never by default:

1. **Floor (always present):** the `AGENTS.md`/`CLAUDE.md` orientation hierarchy (root + per-package + per-service) plus **agentic search** (grep / glob / read). There is deliberately **no embedding/RAG index** for code.
2. **Now (adopted, Milestone 1):** **LSP** for symbol-level precision — the `typescript-lsp` plugin (go-to-definition, find-references, diagnostics; out-of-process, ~0 token cost) and **Serena MCP** (`.mcp.json`, LSP-backed symbol navigation and symbolic edits across packages). Fresh, exact, local — consistent with the determinism / no-globals discipline.
3. **Trigger → repo-map** (Aider-style tree-sitter + PageRank): only when agents visibly burn context re-discovering structure.
4. **Trigger → code knowledge graph** (tree-sitter → SQLite, e.g. codegraph / LocAgent): only when cross-service blast-radius and refactor questions span roughly ten services and need multi-hop traversal.
5. **Trigger → RAG / Sourcegraph SCIP:** only at genuine multi-repo, polyglot, or org scale. Out of scope for one cohesive monorepo.

Rule of thumb: orientation files + agentic search are the floor and never go away; LSP is the next-cheapest precision layer (adopted); everything heavier is gated by measured pain (token burn, cross-service coupling), not adopted speculatively.

## Consequences

### Positive

- Always fresh (live reads, no index to invalidate), exact-match precision, fully local/private — no code is embedded or sent out.
- Minimal moving parts now; the harness documents its own navigation strategy (AGENTS.md "Code intelligence").
- A written ladder means future scaling is a deliberate, triggered decision rather than a reflex.

### Negative / trade-offs accepted

- LSP needs a per-language server; Serena needs `uv`/`uvx` and indexes on first use.
- Agentic search is token-hungry on large repos; rising token-per-task is the explicit signal that triggers step 3.

## Rejected alternatives

- **Embedding / RAG vector index now.** Staleness, chunking destroys structure, fuzzy positives, privacy egress; Anthropic's own A/B test dropped it for code. Premature and a poor fit for actively-edited code.
- **Sourcegraph SCIP / Cody-scale precise intelligence now.** Compiler-accurate and excellent at org scale, but heavy CI/indexer infrastructure that a single small monorepo cannot justify.

## Related decisions

- `docs/01-vision.md` (agent-hospitable substrate principle), `AGENTS.md` ("Code intelligence" section).
- Sibling Milestone decisions: [ADR-0002](0002-asyncapi-drift-gate.md), [ADR-0003](0003-websocket-mock-strategy.md).
