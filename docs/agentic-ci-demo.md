# Agentic CI/CD demonstration (Milestone 10, movement 2)

Movement 1 of Milestone 10 built `services/qaroom-mcp`: a *tested* tool surface. Movement 2
is the payoff: autonomous agents acting on QARoom act **through** that surface, and a tested
surface is the difference between reliable and trust-me (ADR-0006).

This is a **demonstration you run**, not a CI gate. It spawns real Claude Code subagents and
(from Milestone 3 onwards) ephemeral cluster namespaces, so it is user-triggered and billed:
the repository ships the substrate (the tool surface, the goals manifest, the result
discipline), not an always-on job.

## Shape

Ten parallel Claude Code subagents, each:

1. Provisions its own ephemeral namespace: `scripts/spin-up-ephemeral.sh <agent-name>` (Milestone 3
   onwards). Pre-cluster, each runs against an in-process `McpCore` instead.
2. Consumes the **tested tool surface**: it reads `mcp-manifest.json` / `tools/list`, calls
   read tools (`content_*`, `gateway_*`), and self-checks any code it writes with
   `qaroom_conventionsCheck` *before* committing. Structured `next_actions` on an RFC 7807 tool
   error tell it whether to retry, back off, or stop.
3. Works a single scoped goal from `docs/agentic-ci/goals.json`.
4. Reads the frozen `test-results/summary.json` (the `qaroom://test-results/summary` resource) as
   its definition of done: the same frozen schema every runner folds into.

The point is not the agents; it is that **the tool surface they lean on is drift-gated, RFC 7807,
deterministic, and property-tested**; so a fleet of agents gets reliable structured failures
instead of opaque strings, and the demonstration is reproducible.

## Why through the MCP server, not curl

A solo dev with `curl` + the OpenAPI + `pnpm lint` covers a read-only surface (ADR-0006's honest
utility note). The value shows up at *fleet* scale: ten agents hitting raw HTTP get ten
ad-hoc error-handling paths; ten agents hitting the tested server get one closed
`FailureDomain` enum, one `next_actions` contract, and one conventions oracle: the substrate
that makes autonomous CI behaviour predictable enough to demonstrate.

## Running it

```bash
# 1. (cluster) provision namespaces, or skip for the in-process core
bash scripts/spin-up-ephemeral.sh agent-01    # … through agent-10

# 2. start the MCP server (HTTP transport) per namespace, or embed McpCore in-process
pnpm --filter @qaroom/qaroom-mcp dev

# 3. drive the fleet from goals.json with your Claude Code orchestration of choice,
#    each agent pointed at its namespace's MCP endpoint, consuming tools/resources only.
```

Each goal in `docs/agentic-ci/goals.json` names the tools/resources it is allowed to touch and
the `summary.json` condition that marks it done. Keep goals **read-first** until the mutating
`callTool` surface lands (a second pass, gated by an ADR amendment).

## What this demonstrates vs. does not

- **Does**: a tested LLM tool surface as the substrate for autonomous, parallel agents; structured
  recovery; the frozen `summary.json` as a shared, machine-readable definition of done.
- **Does not**: prove anything about the agents' own reasoning quality. That is the Milestone 9
  eval/metamorphic story. Movement 2 tests the *substrate*, not the model.
