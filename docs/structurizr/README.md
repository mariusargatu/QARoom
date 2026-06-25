# Structurizr — QARoom architecture (and testing architecture) as code

The C4 model of QARoom **and** its testing architecture live here as Structurizr DSL — the single
source for the architecture diagrams. The canonical rendered views are the **published model site**
([mariusargatu.github.io/QARoom/architecture](https://mariusargatu.github.io/QARoom/architecture/)),
regenerated from `workspace.dsl` on every push by `.github/workflows/pages.yml`; export local
`structurizr-*.mmd`/PlantUML on demand with the CLI (below) — those exports are **not** committed.
Grounded in `services/*`, `deploy/*`, and the manifests under `scripts/lib/manifests/` — the prose
landscape is the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

The model is **split into many small files** so it stays diffable and maintainable: a PR that moves
a service boundary touches one file, in the same commit. `workspace.dsl` is just the entry point
that `!include`s the rest.

## How this is organized

```
workspace.dsl                 entry point: !include of model + views, and !docs
model/
  people.dsl                  personas + external software systems
  platform.dsl                the QARoom system: containers + per-container TESTING perspective
  components/
    content.dsl               content-service components (the fleet template)
    gateway.dsl               gateway components (proxy/clients/breaker/ws/event-stream)
    moderator.dsl             moderator-agent LangGraph RAG-trajectory nodes
    webhooks.dsl              webhooks delivery-edge components
  relationships.dsl           EVERY structural edge (context + container + component), one place
  testing.dsl                 the testing architecture: 12 boundaries, techniques (by tier),
                              11 falsifiable claims, contract triangulation, governance gates
  deployment.dsl              the k3d (local) deployment topology
views/
  structural.dsl              C4 views: context, containers, 4 component, 4 dynamic, deployment
  testing-views.dsl           custom views: boundary map, honeycomb tiers, claims, triangulation
  styles.dsl                  element + relationship styles (self-contained, offline)
docs/                         embedded documentation (the Lite "Documentation" tab): 01-overview + components
```

The two embedded docs are [`docs/01-overview.md`](docs/01-overview.md) (the model + view index) and
[`docs/components.md`](docs/components.md) (the four component breakdowns + dynamic flows).

The counts in this doc are **hand-maintained projections** of their sources of truth (this folder is
not drift-gated, unlike `ARCHITECTURE.md`): the **12 boundaries** come from
`scripts/lib/manifests/boundary-registry.ts`, the **11 falsifiable claims** from
`scripts/lib/manifests/claims.ts`, and the **9 services** / **16 views** are on-disk
(`services/*` / the views table below). Re-derive and update them here when they change.

## Views

| View | Type | What it shows |
|---|---|---|
| `Context` | System Context | Personas + external systems (OpenAI, payment provider, webhook receivers, observability) around QARoom |
| `Containers` | Container | The 9 services + per-service Postgres + NATS; solid edges sync, **dashed** async |
| `ContentComponents` | Component | Inside content-service: the layered template the fleet follows |
| `GatewayComponents` | Component | Inside the gateway: proxy routes + clients + bounded/circuit-broken caller + WS + event feed |
| `ModeratorComponents` | Component | Inside moderator-agent: the RAG trajectory (retrieve → rerank → … → record) |
| `WebhookComponents` | Component | Inside webhooks: fan-out consumer → ledger → delivery machine → signed sender |
| `CreatePostFlow` | Dynamic | Sync write + transactional outbox → async fan-out to moderator + webhooks |
| `ModerationTrajectory` | Dynamic | One `post.created` through the 6-node RAG trajectory |
| `WebhookDelivery` | Dynamic | One event → a signed delivery driven by the delivery XState machine |
| `FlagRollout` | Dynamic | A rollout transition propagating to the flag_cache projection + the WS feed |
| `Deployment` | Deployment | The k3d cluster: app vs observability namespaces, ingress, pods, per-service Postgres |
| `TestingBoundaryMap` | Custom | **The central artifact:** every boundary and the technique(s) that defend it |
| `TestingHoneycombTiers` | Custom | The technique portfolio grouped by cost tier (in-process → cluster → LLM eval) |
| `FalsifiableClaims` | Custom | The nine `pnpm prove` claims and the boundary each defends |
| `Triangulation` | Custom | Zod source → four contract tools, four directions of agreement |
| `EvidenceGovernance` | Custom | `summary.json` + the drift gates + the gauntlet |

Browse the rendered views on the **published model site**
([/architecture](https://mariusargatu.github.io/QARoom/architecture/)), or run Structurizr Lite
locally (below) for the interactive editor.

## Interactive editing (Structurizr Lite)

For a live, browsable editor with the **Documentation** + **Decisions** tabs, run Lite from the
**repo root** (so `!adrs ../adr` resolves) and open <http://localhost:8080>:

```bash
docker run --rm -p 8080:8080 \
  -v "$(git rev-parse --show-toplevel):/usr/local/structurizr" \
  -e STRUCTURIZR_WORKSPACE_PATH=docs/structurizr \
  structurizr/lite
```

## Regenerate / validate (Docker, no local install)

The CLI is not wired into CI (the build is dispatch-only and these diagrams aren't a merge gate) —
run it on demand. **Pin the real CLI tag** `2024.11.04`: `structurizr/cli:latest` is now a
deprecation stub that prints a banner and exits 0 without doing anything. Mount the **repo root**
(the workspace `!adrs ../adr` reaches `docs/adr`):

```bash
cd "$(git rev-parse --show-toplevel)"

# validate the whole modular workspace parses (exit 0 = OK)
docker run --rm -v "$PWD:/work" -w /work structurizr/cli:2024.11.04 \
  validate -workspace docs/structurizr/workspace.dsl

# export the Mermaid views on demand (one structurizr-<ViewKey>.mmd per view) into docs/structurizr/ — NOT committed
docker run --rm -v "$PWD:/work" -w /work structurizr/cli:2024.11.04 \
  export -workspace docs/structurizr/workspace.dsl -format mermaid -output docs/structurizr
```

Other `-format` values: `plantuml`, `dot` (Graphviz), `json` (the Structurizr workspace model).

## How to maintain

Change the architecture in the DSL only — the published site re-renders from it on push (there is
no committed `.mmd` to maintain). The edit map:

- **Add / change a service** → `model/platform.dsl` (container + its TESTING perspective),
  `model/relationships.dsl` (its edges), `model/deployment.dsl` (its pod + DB), and add a row to the
  view index in [`docs/01-overview.md`](docs/01-overview.md). A component breakdown is optional (`model/components/`).
- **Change a relationship** → `model/relationships.dsl` (tag `Sync`/`Async` so styling + reading stay right).
- **Change a boundary or a falsifiable claim** → edit the source of truth first
  (`scripts/lib/manifests/boundary-registry.ts` / `claims.ts`), then mirror it in `model/testing.dsl`.
  `testing.dsl` is a hand-authored **projection** of those manifests; its header lists the coupling.
- **Restyle** → `views/styles.dsl` only (styles are by tag; add a style when you add a tag).

DSL gotchas (the parser is line-oriented): keep each `{ … }` block body and each `include …` /
`autolayout …` statement on its **own line**; don't put a trailing `//` comment on an `!include`
line; in the deployment env every ancestor `deploymentNode` needs an identifier so children are
addressable by full path (`ws.cluster.obsNs.collector`).

## Decisions

`workspace.dsl` embeds two things: `!docs docs` (the two model-local guides → the Documentation
tab) and `!adrs ../adr` (the canonical ADRs → a native **Decisions** tab, rendered read-only — the
ADRs stay single-sourced in [`../adr`](../adr), never edited here). Both resolve because the build
and Lite run from a **repo-root mount**, so `../adr` is in scope. Run accordingly:

```bash
# CLI validate / export (repo root mounted)
docker run --rm -v "$(git rev-parse --show-toplevel):/work" -w /work structurizr/cli:2024.11.04 \
  validate -workspace docs/structurizr/workspace.dsl

# Lite (repo root mounted; point it at the workspace subdir)
docker run --rm -p 8080:8080 \
  -v "$(git rev-parse --show-toplevel):/usr/local/structurizr" \
  -e STRUCTURIZR_WORKSPACE_PATH=docs/structurizr \
  structurizr/lite
```

(The ADR importer requires numerically-prefixed files only, so `docs/adr/` holds `NNNN-*.md` and
no `README.md` — the decision index is the root `ARCHITECTURE.md` §6 + this native Decisions tab.)

## Notes

- `qaroom-mcp` is modeled as a container but is **not cluster-deployed** (no `Dockerfile`/chart,
  ADR-0006) — so it has no instance in the deployment view; it reads the services' capabilities over HTTP.
- Databases are one-per-service (Postgres; moderator adds pgvector), shown as separate containers
  because they are separate schemas/instances, not a shared DB.
- The testing architecture appears **twice on purpose**: as standalone diagrams
  (`testing-views.dsl` over `model/testing.dsl`) and as a `Testing` / `Boundary` **perspective** on
  each container in `platform.dsl` (visible per-element in Lite) — the same map, overlaid on the C4 structure.
