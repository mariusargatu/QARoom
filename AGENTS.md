# AGENTS.md

You are working on **QARoom**, a multi-tenant social platform built to demonstrate testing-driven architecture. This file is your quick reference. Read it first, then read the docs in `docs/` in numbered order. Per-package conventions live in each package's own `AGENTS.md` (loaded as you navigate there): keep this root file lean. *Reviewed through Milestone 12.*

## Commands

```bash
# install
pnpm install

# build all services
pnpm build

# test (all layers, watch mode for affected packages)
pnpm test
pnpm test --filter <service-or-package>

# lint and format
pnpm lint
pnpm format

# generate OpenAPI from Zod for all services
pnpm openapi:generate

# verify OpenAPI matches Zod + no breaking changes vs committed
pnpm openapi:verify

# regenerate + drift-gate the cross-service MCP tool manifest (Milestone 10)
pnpm mcp:generate
pnpm mcp:verify

# verify the test-results/summary.json schema after a CI run
pnpm test-results:verify

# bring up the local cluster (Milestone 3 onwards)
pnpm dev          # tilt up against k3d
pnpm dev:down     # tilt down + k3d cluster delete
# Exposed via Traefik Ingress at http://*.localhost (no port-forward): qaroom.localhost (web + /api
# + /ws), moderator.localhost, {grafana,jaeger,prometheus,tracetest,microcks}.localhost. The cluster
# must be (re)created with Traefik + 80/443 mapped: bootstrap-k3d.sh does this; recreate to apply.

# scoped scenario replay (Milestone 7 onwards)
pnpm replay:capture <scenario-name>
pnpm replay:load <scenario-name>

# testing-the-tests (Milestone 8 onwards)
pnpm k6:gen                                   # project SLO_TARGETS -> load-tests thresholds
pnpm k6:results                               # fold a k6 load run into summary.json
pnpm stryker:critical && pnpm stryker:results # mutation testing on the docs/03 §11 modules
pnpm evomaster && pnpm evomaster:results      # EvoMaster v6 black-box fuzzing (needs Java + live content)
pnpm --filter @qaroom/web test:stories        # Storybook play() + a11y, headless (Chromium)
pnpm --filter @qaroom/web ct                  # Playwright Component Tests
pnpm --filter @qaroom/web coverage:merge      # unified V8 (Vitest) + Istanbul (CT) coverage
```

## Code intelligence

Navigate by **agentic search** (grep / glob / read), the default: always fresh, exact-match, no index. There is deliberately **no embedding/RAG index**; for source code, agentic search plus LSP beats a vector store on freshness, precision, and privacy. Add symbol-level precision with LSP:

- **TypeScript LSP**: the `typescript-lsp` plugin (user-scoped, out-of-process, ~0 token cost). Gives go-to-definition, find-references, and type diagnostics; activates automatically on `.ts` files. Install once per machine: `claude plugin install typescript-lsp@claude-plugins-official`.
- **Serena MCP**: configured in `.mcp.json` (project-scoped, versioned). LSP-backed symbol navigation and symbolic edits across packages. First use: run `claude`, approve the server, then `uvx` fetches it and indexes the repo (requires `uv`/`uvx`).

Reach for a repo-map or code graph only if cross-service scale ever makes agentic search burn too much context, not before (complexity must earn its place).

## Repository layout

- `services/`: one directory per microservice (`content`, `gateway`, `identity`, `flags`, `donations`, and the React/Vite `web` frontend as of Milestone 5; the Python `moderator-agent` as of Milestone 9; `webhooks` as of Milestone 11). Each backend has its own `AGENTS.md`, `openapi.yaml`, `src/`, and `Dockerfile`; `web` adds an atomic-design component library (see `services/web/docs/atomic-structure.md`). `moderator-agent` is the one Python service: `uv`/FastAPI/LangGraph, not pnpm/tsx (ADR-0018). (The per-service `chart/` sketch was superseded in Milestone 3 by the shared `packages/helm-template/` + `deploy/<service>/values.yaml`.)
- `packages/`: shared code: `contracts/` (Zod, OpenAPI, XState, hand-authored machines in `contracts/src/machines/`, invoke-free + context-free), `otel/` (OpenTelemetry SDK, `tenant.id` span processor, propagation primitives, Milestone 3; M4's `messaging/` will build the NATS layer on it), `service-kit/`, `testing-utils/` (fixtures, generators, harness, `contract-crosscheck/`), `helm-template/` (the shared `qaroom-service` chart), and `qaroom-mcp/` (the cross-service MCP server as a first-class tested service, Milestone 10, ADR-0006; read-first tool surface generated from the operation registries, four typed gates).
- `deploy/`: per-service Helm values (`<service>/values.yaml`) and `observability/` manifests (OTel Collector, Jaeger, Prometheus, Grafana). `Tiltfile` at the repo root drives the local cluster.
- `docs/`: architecture, strategy, roadmap, conventions, ADRs. Read in numbered order.
- `chaos-experiments/`: Chaos Mesh and Litmus YAML (Milestone 6 onwards).
- `scripts/`: orchestration scripts. `bootstrap-k3d.sh`/`teardown-k3d.sh`, `smoke.sh`, `check-tenant-spans.ts`, `aggregate-test-results.ts`.
- `.claude/`: agent definitions and skills. `.claude/skills/journey-log/` captures per-decision entries into `docs/journey/`; raw material for blog/LinkedIn.

## Conventions you must follow

These are enforced by lint and CI. Violating them will fail the build.

- **No direct `new Date()` in non-test code.** Use the injected `Clock`.
- **No `Math.random()` or `crypto.randomUUID()` in non-test code.** Use injected `Randomness` or `IdGenerator`.
- **No `toMatchSnapshot()` anywhere.** Snapshot testing is forbidden.
- **No conditional logic in tests** (`if`, `try/catch` for assertion purposes). Two tests instead.
- **No barrel exports for non-public APIs.** Each module imports what it needs directly.
- **No files longer than 500 lines, including tests.** Refactor.
- **No `any` in non-test code.** Use `unknown` if type information is genuinely absent.
- **Every non-2xx response uses RFC 7807 Problem Details** with `retryable`, `next_actions`, `failure_domain` extensions.
- **Every span carries `tenant.id`.**
- **Every NATS event has a Zod schema and a name.** Never publish untyped JSON. Subject grammar: `qaroom.<service>.<entity>.<community_id>.<event>`. `community_id` is fixed position 3, never optional.
- **Every event publisher sets `Nats-Msg-Id` from the `IdGenerator`.** Consumers dedupe via the `processed_events` table (helpers in `@qaroom/messaging`). Raw `qaroom.*` subject string literals at call sites fail lint. Use the `subjects.ts` builders.
- **Single-writer-per-resource.** Mutations include `Idempotency-Key`; replays served from per-service `idempotency_responses`. Concurrent writes serialized by Postgres advisory locks + `SELECT … FOR UPDATE`.
- **Every mutating endpoint declares OAS `links`** so Schemathesis stateful-links has something to follow.

## How to make changes

For any non-trivial change:

1. **Read the relevant docs first.** `docs/02-architecture.md` for the system shape; `docs/03-testing-strategy.md` for testing decisions; `docs/05-conventions.md` for what's enforced; the relevant ADR.
2. **Identify which boundary your change touches.** Use the boundary table in `docs/02-architecture.md`. Your change should use the testing technique that defends that boundary.
3. **For schema changes:** edit the Zod schema in `packages/contracts/`, run `pnpm openapi:generate`, commit both. CI will gate breaking changes via `oasdiff`.
4. **For state machine changes:** edit the XState machine in `packages/contracts/machines/`, update the conformance test, update any MBT-generated tests.
5. **For new endpoints:** they must have an `operationId` (camelCase), a `summary`, a `description`, at least one example per response code, and a Pact consumer test from whoever calls them.
6. **For tests:** prefer the shared generators in `packages/testing-utils/generators/` over constructing domain objects inline.

## Do not touch

- `docs/adr/0001-foundational-decisions.md`: immutable. Any change here requires a new superseding ADR.
- `services/*/openapi.v*.yaml`: frozen specs at release boundaries. Backward compatibility is verified against them.
- `packages/contracts/test-results-schema.ts`: the schema for `test-results/summary.json` is frozen.
- `chaos-experiments/*.yaml`: each is paired with a documented expected-behavior assertion in `docs/failure-modes.md`. Change both or neither.

## Where state lives

QARoom is a *deliberately* multi-state system. When you need to find the truth about something, look here first.

- **Domain state** (posts, votes, communities) lives in each service's Postgres.
- **Cross-service events** flow through NATS JetStream. Replayable from the durable streams.
- **Feature flag state** lives in flags-service's Postgres, accessed through the flag-resolution API.
- **State machine state** is reported via each service's `/system/state` endpoint. Do not invent your own state-inspection mechanism.
- **Test state** is reset per test by the harness in `packages/testing-utils/`. No shared mutable state across tests.
- **Time** is `clock.now()`. **IDs** are `idGenerator.next()`. **Randomness** is `randomness.next()`. Never reach for globals.

## Milestone awareness

QARoom is built across 12 milestones. The current milestone determines what services and capabilities exist.

| Milestone | New | What's not yet built |
|---|---|---|
| 0 | content-service, determinism, Vitest, fast-check, Zod+OpenAPI, oasdiff, branded IDs, AGENTS.md substrate, SLO baseline, Milestone 0 spikes (EvoMaster, Schemathesis stateful, Pact-OAS cross-check) | Everything else |
| 1 | gateway, Pact, Schemathesis, Pact↔OpenAPI cross-check, rate limiting with `failure_domain: rate_limit` | Multi-tenancy, K8s, async |
| 2 | identity-service, JWT issuance + JWKS contract, communities-as-tenants, property-based isolation, migration as state machine | K8s, async |
| 3 | k3d, Tilt, Helm, OpenTelemetry, Jaeger, Prometheus, Grafana | Async messaging, state machines beyond migration |
| 4 | NATS JetStream, `@qaroom/messaging` (outbox + processed_events + idempotency_responses migrations), async Pact, Tracetest, AsyncAPI + drift gate, dedup discipline (Commitment 17) | Feature gating |
| 5 | flags-service, donations-service, web frontend, XState, MBT, reverse-conformance via OTel + Tracetest, Microcks, WebSocket push (JWT-via-subprotocol auth) + polling parity, Screenplay foundation | Chaos, scenario replay, agent |
| 6 | Chaos Mesh, Litmus, chaos experiments (chaos manifests captured into snapshot for replay), failure-modes.md | Scenario replay, agent |
| 7 | qaroom-replay CLI, /system/snapshot endpoints with versioned bundle manifest, regression catalog | Agent |
| 8 | k6 vs SLOs, Stryker mutation (docs/03 §11 modules), EvoMaster v6 black-box (M0 spike passed), Storybook 10 + Vitest 4 + Playwright CT + unified coverage, ADR-0016 | Agent |
| 9 | moderator-agent (Python `uv`/FastAPI/LangGraph + pgvector), structured outputs (Pydantic↔Zod cross-language gate), Promptfoo golden-set evals (OpenAI), metamorphic paraphrase-invariance + deliberate prompt-bug demo, LangGraph reverse-conformance (xstate.transition spans), per-run cost guard, ADR-0017, ADR-0018 | - |
| 10 | `packages/qaroom-mcp`: the cross-service MCP server as a first-class tested service (ADR-0006). Read-first tool surface (capabilities proxy + RFC 7807 tool errors + read resources + conventions oracle), both transports (in-memory + JSON-RPC/Fastify), four typed gates (manifest drift + breaking-change classifier, RFC 7807 property tests, determinism-trio golden transcript, property + metamorphic tool I/O cross-checked vs `/system/capabilities` + `openapi.yaml`). Movement 2 (agentic-CI demonstration) documented in `docs/agentic-ci-demo.md`. Mutating `callTool` deferred to a second pass. | - |
| 11 | `services/webhooks`, outbound delivery edge (ADR-0019): pure consumer of all five NATS channels, subscription CRUD (gateway-proxied), durable delivery ledger + relay-shaped worker, hand-authored webhook-delivery XState machine + reverse-conformance + MBT, deterministic capped-jittered retry contract, HMAC-SHA256 signing (timestamp bound in), SSRF guard, at-least-once + receiver dedup. Six env-toggled deliberate-bug demos. | - |
| 12 | moderator v2, retrieval-grounded RAG agent (ADR-0020): per-community policy corpus in pgvector, 5-node trajectory (retrieve->gather_precedent->draft->self_check->record), citation-bearing `disposition ∈ {approve,remove,escalate_to_human}` (`cited_rules`/`precedents`/`departs_from_precedent`/`rationale`) + abstain/escalate path, prompt-injection input guard (`guard.py`, failure-modes). DeepEval (RAG + agentic + G-Eval) / DeepTeam (OWASP LLM Top 10) / PyRIT eval+red-team stack, key-gated; **Promptfoo dropped**. Breaking event v2 (verdict->disposition). | - |

Always check the current milestone before introducing infrastructure that doesn't yet exist. The roadmap in `docs/04-roadmap.md` has full exit criteria per milestone.

## CI gates

A PR cannot merge unless:

1. Unit, property, integration, and contract tests pass (`pnpm test`).
2. Lint and type-check pass (`pnpm lint`, `pnpm typecheck`).
3. `oasdiff` reports no undeclared breaking changes.
4. `test-results/summary.json` is produced and validates against its frozen schema.
5. PR description includes the required sections (What, Why, Test plan, Demonstration if introducing a technique).

## Where to ask "is this in scope?"

If a change feels like it crosses an architectural commitment, read `docs/adr/0001-foundational-decisions.md` and check the rejected alternatives. The deliberate exclusions list is in `docs/02-architecture.md` section "What this architecture deliberately omits."

If still unsure, do not invent. Open a discussion in the PR or wait for input.

## How tests are organized

Current-milestone essentials (full layout, including the Milestone 5–6 E2E/MBT/component/chaos
conventions, lives in `packages/testing-utils/AGENTS.md`):

- **Co-located unit tests:** `src/foo.ts` ↔ `src/foo.test.ts`. **Integration:** `src/foo.spec.ts`.
- **Property tests:** alongside unit tests, named `*.property.test.ts`.
- **Contract tests:** `services/<consumer>/tests/contracts/`; provider verification in the provider.
- **Generators, matchers, harness:** `packages/testing-utils/`, reach for an existing one first.

Use them. Do not invent parallel structures.

## Claude Code notes

These apply specifically to Claude Code. Other agents may skip.

- `CLAUDE.md` is a symlink to this file. Do not edit `CLAUDE.md` directly; edit `AGENTS.md`.
- Use `claude --worktree` for any non-trivial feature work; worktree isolation prevents file conflicts.
- From Milestone 3 onwards, each worktree should provision its own ephemeral namespace via `scripts/spin-up-ephemeral.sh <worktree-name>`. Pre-Milestone-3 the cluster does not yet exist; use git worktrees alone.
- `.claude/skills/` is the canonical location for skills. `journey-log` ships in v1; more skills land milestone by milestone as patterns emerge.
- Use `/journey-log` after any architectural choice, technique demonstration, pivot, or surprise: the skill captures a structured entry under `docs/journey/`. Do not commit on the user's behalf; let them review and stage with the matching code change.
- When you author a skill: the `description` field in YAML frontmatter determines activation: be specific and signal-dense. Keep body under 500 lines; reference external files for anything longer. Prefer scripts over prose.

### Locked vs open

The 16 + 1 commitments in `docs/adr/0001-foundational-decisions.md` are immutable once code lands. Implementation choices (library versions, file formats, helm chart shape) are open and made milestone by milestone. If unsure which category a question lives in, ask before proposing.
