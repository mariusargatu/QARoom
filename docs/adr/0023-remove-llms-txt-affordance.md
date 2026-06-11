# ADR 0023: Remove the llms.txt affordance; AGENTS.md and the MCP surface are the agent front door

- **Status:** Accepted
- **Date:** 2026-06-11
- **Supersedes:** the `/.well-known/llms.txt` clause of ADR-0001 Commitment 15 ("agent-hospitable
  from day one"). Every other Commitment 15 affordance stands unchanged: root and per-service
  `AGENTS.md` (with `CLAUDE.md` symlink), `.claude/agents/` and `.claude/skills/`,
  `scripts/spin-up-ephemeral.sh`.
- **Relates to:** ADR-0006 (the MCP server as the tested tool surface), ADR-0022 (gateway routes
  whose absence from the gateway's llms.txt copy demonstrated the rot).
- **Records:** the decision to delete a zero-consumer affordance rather than build drift gates
  for it.

## Context

Commitment 15 required `/.well-known/llms.txt` at the repo root and per service as insurance for
future agentic features, explicitly building none in v1: "the affordances exist so they can be
added without rework."

Twelve milestones later, the file has had zero consumers. No service serves it over HTTP. No
script, test, or agent reads it. The root copy froze at Milestone 0 and stayed twelve milestones
stale (1 of 8 services, "10 milestones", "TypeScript end-to-end" after the Python moderator
shipped); its first reader ever was the 2026-06-10 docs audit that caught it lying. The
per-service copies rot the same way: the gateway copy never learned about the webhook CRUD and
moderation routes added in ADR-0022.

Meanwhile, everything the insurance was bought for got built, better:

- **AGENTS.md** (root + per service) is the repository agent entry point, reviewed each
  milestone, and is the convention that won for git repositories.
- **`GET /system/capabilities`** is the live, machine-readable, MCP-tool-shaped surface, and it
  is tested.
- **`packages/qaroom-mcp`** (ADR-0006) is a first-class tested MCP server over those
  capabilities, with four typed gates.

The llms.txt spec itself targets served websites (`https://site/llms.txt`), not repository file
trees. A repository visitor, human or agent, lands on AGENTS.md.

## Decision

Delete `/.well-known/llms.txt` at the repo root and in every service. The agent front door is
AGENTS.md, `GET /system/capabilities`, and the qaroom-mcp tool surface. If a served documentation
site ships later, its llms.txt is generated there by the site tooling, where the file has real
consumers and a real URL.

## Consequences

- Seven unguarded projections that could silently contradict the drift-gated README no longer
  exist. The 2026-06-10 audit's finding class ("drift hits exactly the surfaces outside a drift
  gate") is closed by removal instead of by seven new gates.
- `claims:verify` keeps gating the README blocks and the claims page only; the llms.txt block
  check added on 2026-06-11 is reverted along with its renderer.
- **Rejected alternative: keep the root file behind the new drift gate.** Gating a file with no
  readers is maintenance without a customer; complexity must earn its place. The gate machinery
  (`stats:render` + `claims:verify` byte-comparison) stays available if a served docs site ever
  needs a generated llms.txt.
- ADR-0001 stays untouched, per its own rule: this ADR supersedes one clause by reference.
