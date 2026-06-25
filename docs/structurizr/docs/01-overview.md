# QARoom architecture model

This Structurizr workspace is the C4 model **and** the testing architecture as code: one
diffable source for the system shape, the boundaries it exposes, and the technique(s) that
defend each. It is grounded in `services/*` (ports, comms, component breakdowns) and the
manifests under `scripts/lib/manifests/` (`boundary-registry.ts`, `claims.ts`).

The thesis: **testability is an architectural property**. The system is shaped to be testable,
and the tests are shaped to the boundaries. The one-page mental model — system, testing, decisions,
and the boundary-to-technique reasoning — is
[`ARCHITECTURE.md`](https://github.com/mariusargatu/QARoom/blob/main/ARCHITECTURE.md); this site
renders it visually.

## How to read the model

- The **Diagrams** tab holds the 16 views below (auto-laid-out C4 + custom testing diagrams).
- The **Documentation** tab holds these files (rendered in lexical filename order).
- Each container also carries a `Testing` and a `Boundary` perspective (visible on hover and in
  the element table) — the testing story overlaid directly onto the C4 structure.

## View index

The structural views come from [`../views/structural.dsl`](../views/structural.dsl); the testing
views from [`../views/testing-views.dsl`](../views/testing-views.dsl).

| View | Type | What it shows |
|---|---|---|
| Context | System Context | Personas and the external systems QARoom depends on (OpenAI, payment provider, webhook receivers, observability backplane). |
| Containers | Container | Services, per-service Postgres, and the NATS backbone; dashed edges are async (NATS), solid are sync (HTTP/SQL). |
| ContentComponents | Component | Inside `content-service`: the layered fleet template — routes → repository → events/db/faults plus the outbox relay. |
| GatewayComponents | Component | Inside the gateway: proxy routes + per-upstream clients over a bounded, circuit-broken caller; WS upgrade + ticket; the event-feed stream. |
| ModeratorComponents | Component | Inside `moderator-agent`: the RAG trajectory consumer → guard → retrieve → rerank → gather_precedent → draft → self_check → record → publish. |
| WebhookComponents | Component | Inside `webhooks`: fan-out consumer → delivery ledger; the worker drives the delivery XState machine through the signed sender (SSRF + retry). |
| CreatePostFlow | Dynamic | Create a post: synchronous write + transactional outbox, then async fan-out to moderator + webhooks. |
| ModerationTrajectory | Dynamic | The RAG trajectory for one `post.created`: retrieve → rerank → precedent → draft → self-check → record (ADR-0020/0021). |
| WebhookDelivery | Dynamic | One event fans out to a delivery; the worker drives the XState machine through the signed sender with deterministic retry. |
| FlagRollout | Dynamic | A donations-rollout transition propagates: flags publishes, the projection and the live WS feed react. |
| Deployment | Deployment | The local k3d cluster: app vs observability namespaces; one shared Helm chart per release; Postgres per service; `qaroom-mcp` is not deployed. |
| TestingBoundaryMap | Custom | The central artifact: every architectural boundary and the technique(s) that defend it (per `boundary-registry.ts`; rendered as `ARCHITECTURE.md` §3). |
| TestingHoneycombTiers | Custom | The technique portfolio grouped by cost tier: in-process (Vitest/pytest) → cluster-live (k3d) → LLM evaluation (key-gated). |
| FalsifiableClaims | Custom | Each claim holds without its toggle and goes RED with it (`pnpm prove <id> --break`); the manifest can never decay into theater (`pnpm claims:verify`). |
| Triangulation | Custom | Contract triangulation: Zod is the single source; OpenAPI/AsyncAPI are generated + committed; Pact is independently authored — no silent drift (ADR-0001 C3). |
| EvidenceGovernance | Custom | Every runner folds into a frozen-schema envelope that the drift gates and the gauntlet read; numbers are projected, never typed. |

## File layout

| Path | Holds |
|---|---|
| [`../workspace.dsl`](../workspace.dsl) | **Entry point.** Assembles the model + views + embedded docs. |
| `model/people.dsl` | Personas and external software systems. |
| `model/platform.dsl` | The QARoom system: containers, the four component breakdowns, per-container testing perspectives. |
| `model/relationships.dsl` | Every structural edge (context + container + component). |
| `model/testing.dsl` | The testing architecture: boundaries, techniques (by tier), claims, triangulation gates. |
| `model/deployment.dsl` | The k3d (local) deployment topology. |
| `model/components/` | Per-service component definitions (`content`, `gateway`, `moderator`, `webhooks`). |
| `views/structural.dsl` | C4 views: context, containers, components, dynamics, deployment. |
| `views/testing-views.dsl` | Custom views over `model/testing.dsl` (the five testing diagrams). |
| `views/styles.dsl` | Element + relationship styles by tag (self-contained, offline). |
| `docs/` | These embedded documentation files. |

Evidence numbers (pass/fail, coverage, SLO outcomes) live in `test-results/summary.json`, not here.
The structural counts (boundaries, claims, views) are hand-maintained against the manifests
(`boundary-registry.ts`, `claims.ts`) and re-derived on change — this folder is **not** drift-gated
(unlike `ARCHITECTURE.md`, whose §3 boundary + §4 claims blocks `pnpm boundaries:render` /
`pnpm claims:verify` byte-gate), so update them here when the manifests change.

## Maintaining this model

Edit the `.dsl` files only; the published site renders from them, and `.mmd` can be exported on demand. See
[`../README.md`](../README.md) for the editing map and the Docker-based regenerate/validate
commands (pinned `structurizr/cli` tag).
