# AGENTS.md

You are working on **QARoom**, a multi-tenant social platform built to demonstrate testing-driven architecture. This file is your quick reference. Read it first, then [`ARCHITECTURE.md`](ARCHITECTURE.md) for the one-page landscape (system + testing + decisions + the "where the truth lives" map). Per-package conventions live in each package's own `AGENTS.md` (loaded as you navigate there): keep this root file lean. *Reviewed through Milestone 12.*

## Commands

```bash
# install
pnpm install

# build all services
pnpm build

# golden path: full suite (in-process PGlite, no Docker) + a rendered summary
pnpm demo

# test (all layers; concurrency capped at 50% of cores — full-fan-out starves the
# PGlite-heavy property suites past their timeouts)
pnpm test
pnpm test --filter <service-or-package>

# lint and format
pnpm lint
pnpm format

# umbrella gates
pnpm check          # smoke: gauntlet phase 1 only (needs a running Docker daemon — Pact lane)
pnpm verify         # CI's verify job locally: lint + typecheck + results fold + every drift gate
pnpm gauntlet       # every technique, one orchestrated run (--only <phase>, --from <phase>)

# falsifiable claims + detection matrix
pnpm prove          # list claim cards; `pnpm prove <id> --break` must turn the named gate red
pnpm claims:verify  # every claim resolves + is falsifiable; README projections + commands census
pnpm matrix         # run the bug x technique detection matrix
pnpm matrix:verify  # matrix census + rendered-matrix drift gate

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
pnpm stryker:critical && pnpm stryker:results # mutation testing on the locked critical modules (ADR-0016)
pnpm evomaster && pnpm evomaster:results      # EvoMaster v6 black-box fuzzing (needs Java + live content)
pnpm --filter @qaroom/web test:stories        # Storybook play() + a11y, headless (Chromium)
pnpm --filter @qaroom/web test:component      # Screenplay component tests (Vitest browser, ADR-0027)
pnpm --filter @qaroom/web test:stories:coverage # single V8 coverage source (no V8+Istanbul merge)
pnpm visual                                   # visual-regression gate in the pinned container (ADR-0027)
pnpm visual:update                            # reseed the committed Linux pixel baselines
```

## Code intelligence

Navigate by **agentic search** (grep / glob / read), the default: always fresh, exact-match, no index. There is deliberately **no embedding/RAG index**; for source code, agentic search plus LSP beats a vector store on freshness, precision, and privacy. Add symbol-level precision with LSP:

- **TypeScript LSP**: the `typescript-lsp` plugin (user-scoped, out-of-process, ~0 token cost). Gives go-to-definition, find-references, and type diagnostics; activates automatically on `.ts` files. Install once per machine: `claude plugin install typescript-lsp@claude-plugins-official`.
- **Serena MCP**: configured in `.mcp.json` (project-scoped, versioned). LSP-backed symbol navigation and symbolic edits across packages. First use: run `claude`, approve the server, then `uvx` fetches it and indexes the repo (requires `uv`/`uvx`).

Reach for a repo-map or code graph only if cross-service scale ever makes agentic search burn too much context, not before (complexity must earn its place).

## Repository layout

- `services/`: one directory per microservice ([`content`](services/content/AGENTS.md), [`gateway`](services/gateway/AGENTS.md), [`identity`](services/identity/AGENTS.md), [`flags`](services/flags/AGENTS.md), [`donations`](services/donations/AGENTS.md), and the React/Vite [`web`](services/web/AGENTS.md) frontend as of Milestone 5; the Python [`moderator-agent`](services/moderator-agent/AGENTS.md) as of Milestone 9; [`webhooks`](services/webhooks/AGENTS.md) as of Milestone 11; the cross-service [`qaroom-mcp`](services/qaroom-mcp/AGENTS.md) server as of Milestone 10, relocated from `packages/` in Phase 3 — ADR-0006). Each backend has its own `AGENTS.md`, `openapi.yaml`, `src/`, and `Dockerfile`; `web` adds an atomic-design component library (see [`services/web/docs/atomic-structure.md`](services/web/docs/atomic-structure.md)). `moderator-agent` is the one Python service: `uv`/FastAPI/LangGraph, not pnpm/tsx (ADR-0018). `qaroom-mcp` is the read-first MCP tool surface over the services' capabilities (no `openapi.yaml`/`Dockerfile` — it is not cluster-deployed; four typed gates, ADR-0006). (The per-service `chart/` sketch was superseded in Milestone 3 by the shared `packages/helm-template/` + `deploy/<service>/values.yaml`.)
- `packages/`: shared code, seven packages: [`contracts/`](packages/contracts/AGENTS.md) (the Zod schema authority: OpenAPI/AsyncAPI generated from it, hand-authored XState machines in `contracts/src/machines/` (invoke-free + context-free), branded IDs, the `subjects.ts` subject-grammar builders, the boundary registry + falsifiable-claims manifest), `determinism/` (the injectable `Clock`/`IdGenerator`/`Randomness` interfaces + production implementations, Commitment 6), [`otel/`](packages/otel/AGENTS.md) (OpenTelemetry SDK wiring, `tenant.id` span processor, propagation primitives), `messaging/` (the NATS JetStream layer on `otel`: outbox, `processed_events` dedup, `idempotency_responses`, relay), `service-kit/` (the shared Fastify service runtime: Problem Details, health + `/system/*` routes, capabilities, DB, env, idempotency), [`testing-utils/`](packages/testing-utils/AGENTS.md) (fixtures, generators, matchers, harness, `contract-crosscheck/`), and `helm-template/` (the shared `qaroom-service` chart). (`qaroom-mcp` moved to `services/` in Phase 3 — it is a tested service, not a shared library, and importing service operation registries from `packages/` was a layering inversion.)
- `deploy/`: per-service Helm values (`<service>/values.yaml`) and `observability/` manifests (OTel Collector, Jaeger, Prometheus, Grafana). `Tiltfile` at the repo root drives the local cluster.
- `docs/`: [`docs/adr/`](docs/adr/) (the decisions), [`docs/structurizr/`](docs/structurizr/) (the C4 + testing model + published site), and the living evidence (`claims.md`, `detection-matrix.md`, `code-tour.md`, `gauntlet.md`, `failure-modes.md`). The one-page landscape is the root `ARCHITECTURE.md`.
- `chaos-experiments/`: Chaos Mesh and Litmus YAML (Milestone 6 onwards).
- `scripts/`: orchestration scripts. `bootstrap-k3d.sh`/`teardown-k3d.sh`, `smoke.sh`, `check-tenant-spans.ts`, `aggregate-test-results.ts`.
- `.claude/`: agent definitions and skills.

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

### Common mistakes (wrong → right)

The same conventions as above, as the wrong/right pairs an agent trips on mid-edit:

| You wrote (fails the build) | Write instead |
|---|---|
| `new Date()` in non-test code | `clock.now()` — the injected `Clock` |
| `Math.random()` / `crypto.randomUUID()` in non-test code | `randomness.next()` / `idGenerator.next()` |
| `expect(x).toMatchSnapshot()` | a typed assertion against an explicit expected value |
| `if`/`try-catch` to branch an assertion in a test | two tests, one per case |
| `publish('qaroom.content.post.…')` (raw subject literal) | a `subjects.ts` builder (`community_id` stays fixed at position 3) |
| `throw new Error()` / bare JSON on a non-2xx response | RFC 7807 Problem Details with `retryable` / `next_actions` / `failure_domain` |
| `: any` in non-test code | `unknown`, then narrow |
| re-stating a bound (e.g. vote ±1) in a second place | derive it from the one source (`VOTE_VALUES`); duplication is a bug, not a pattern |
| a file past 500 lines (tests included) | split it |

## How to make changes

For any non-trivial change:

1. **Read the relevant docs first.** `ARCHITECTURE.md` is the one-page mental model — system, testing, decisions, and the "where the truth lives" map; the relevant ADR for the WHY; `tools/eslint-plugin-qaroom` + the drift gates for what's enforced.
2. **Identify which boundary your change touches.** Use the boundary map in [`ARCHITECTURE.md`](ARCHITECTURE.md#3-the-testing-architecture-a-honeycomb-exploded-by-boundary) §3. Your change should use the testing technique that defends that boundary.
3. **For schema changes:** edit the Zod schema in `packages/contracts/`, run `pnpm openapi:generate`, commit both. CI will gate breaking changes via `oasdiff`.
4. **For state machine changes:** edit the XState machine in `packages/contracts/machines/`, update the conformance test, update any MBT-generated tests.
5. **For new endpoints:** they must have an `operationId` (camelCase), a `summary`, a `description`, at least one example per response code, and a Pact consumer test from whoever calls them.
6. **For tests:** prefer the shared generators in `packages/testing-utils/generators/` over constructing domain objects inline.

## Do not touch

- `docs/adr/0001-foundational-decisions.md`: immutable. Any change here requires a new superseding ADR.
- `services/*/openapi.v*.yaml`: frozen specs at release boundaries. Backward compatibility is verified against them.
- `packages/contracts/test-results-schema.ts`: the schema for `test-results/summary.json` is frozen.
- `chaos-experiments/*.yaml`: each is paired with a documented expected-behavior assertion in `docs/failure-modes.md`. Change both or neither.

## Invariant sources (do not weaken to make a check pass)

Some definitions are a *single source of truth* that derives every downstream enforcement: a Zod
contract in `packages/contracts/` derives the DB constraint, the runtime validator, the OpenAPI doc,
and the property generator; a TLA+ spec in `spec/` is bound to a runtime assertion in the service.
These are **invariant sources** (ADR-0024). The rule, enforced socially by `.github/CODEOWNERS` + the
`invariant-guard` workflow and culturally here:

- **Never weaken an invariant, schema, DB constraint, spec, or its falsifier to make a red check go
  green.** A red means fix the code or surface the conflict — not loosen the rule. That is the exact
  failure mode the experiment exists to prevent.
- **One definition, derived everywhere.** Do not re-state a rule (e.g. the vote `±1` bound) in a
  second place; derive it from the one source. Duplicated bounds are a bug to fix, not a pattern.
- **A change to an invariant source is a deliberate decision**, not a side effect of another task. It
  needs its own ADR and human (Code Owner) sign-off. Do not edit the invariant and its implementation
  in the same change — if a task seems to require it, STOP and write a short proposal.

Covered paths: `packages/contracts/**`, `spec/**`, the falsifiable-claim + detection-matrix manifests
(`scripts/lib/manifests/{claims,detection-matrix}.ts`), and `docs/adr/0001-foundational-decisions.md`.

## Where state lives

QARoom is a *deliberately* multi-state system. When you need to find the truth about something, look here first.

- **Domain state** (posts, votes, communities) lives in each service's Postgres.
- **Cross-service events** flow through NATS JetStream. Replayable from the durable streams.
- **Feature flag state** lives in flags-service's Postgres, accessed through the flag-resolution API.
- **State machine state** is reported via each service's `/system/state` endpoint. Do not invent your own state-inspection mechanism.
- **Test state** is reset per test by the harness in `packages/testing-utils/`. No shared mutable state across tests.
- **Time** is `clock.now()`. **IDs** are `idGenerator.next()`. **Randomness** is `randomness.next()`. Never reach for globals.

## Milestone awareness

QARoom is built across 12 milestones (M1-M12) on an M0 foundation; the table below is M0-M12. The current milestone determines what services and capabilities exist.

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
| 8 | k6 vs SLOs, Stryker mutation (locked critical modules), EvoMaster v6 black-box (M0 spike passed), Storybook 10 + Vitest 4 + Playwright CT + unified coverage, ADR-0016 | Agent |
| 9 | moderator-agent (Python `uv`/FastAPI/LangGraph + pgvector), structured outputs (Pydantic↔Zod cross-language gate), Promptfoo golden-set evals (OpenAI), metamorphic paraphrase-invariance + deliberate prompt-bug demo, LangGraph reverse-conformance (xstate.transition spans), per-run cost guard, ADR-0017, ADR-0018 | - |
| 10 | `services/qaroom-mcp`: the cross-service MCP server as a first-class tested service (ADR-0006). Read-first tool surface (capabilities proxy + RFC 7807 tool errors + read resources + conventions oracle), both transports (in-memory + JSON-RPC/Fastify), four typed gates (manifest drift + breaking-change classifier, RFC 7807 property tests, determinism-trio golden transcript, property + metamorphic tool I/O cross-checked vs `/system/capabilities` + `openapi.yaml`). Movement 2 (agentic-CI demonstration) documented in ADR-0006. Mutating `callTool` deferred to a second pass. | - |
| 11 | `services/webhooks`, outbound delivery edge (ADR-0019): pure consumer of all five NATS channels, subscription CRUD (gateway-proxied), durable delivery ledger + relay-shaped worker, hand-authored webhook-delivery XState machine + reverse-conformance + MBT, deterministic capped-jittered retry contract, HMAC-SHA256 signing (timestamp bound in), SSRF guard, at-least-once + receiver dedup. Six env-toggled deliberate-bug demos. | - |
| 12 | moderator v2, retrieval-grounded RAG agent (ADR-0020): per-community policy corpus in pgvector, 6-node trajectory (retrieve->rerank->gather_precedent->draft->self_check->record; two-stage retrieval, ADR-0021), citation-bearing `disposition ∈ {approve,remove,escalate_to_human}` (`cited_rules`/`precedents`/`departs_from_precedent`/`rationale`) + abstain/escalate path, prompt-injection input guard (`guard.py`, failure-modes). DeepEval (RAG + agentic + G-Eval) / DeepTeam (OWASP LLM Top 10) / PyRIT eval+red-team stack, key-gated; **Promptfoo dropped**. Breaking event v2 (verdict->disposition). | - |

Always check the current milestone before introducing infrastructure that doesn't yet exist. The milestone table above, plus the ADRs, record scope per milestone.

## CI gates

CI is **dispatch-first** (`.github/workflows/ci.yml`): the heavy tiers (chart/cluster/load/mutation/chaos) run on demand from the Actions tab by choosing a cumulative `tier` (`light` < `merge` < `nightly`). There are two automatic triggers, both deliberately cheap: a `pull_request` trigger that runs ONLY the in-process `verify` job (lint + typecheck + scripts tests + test + every in-proc drift gate that needs no `uv`/cluster — `claims:verify` stays in the dispatch-only `claims` job because its moderator teeth need `uv`), so `verify` can be a required status check; and one weekly `schedule` cron that fires the keyed `eval` tier alone (cost-bounded; consumes `secrets.OPENAI_API_KEY`). The PR lane has no `paths-ignore` (a path-filtered required check never reports on an excluded PR and deadlocks merge). The other push-triggered workflow is `.github/workflows/pages.yml`, scoped to `site/**`: it deploys the static site (a one-page plain-English testing overview at [mariusargatu.github.io/QARoom](https://mariusargatu.github.io/QARoom/)) and runs no build/test lane. Locally the same bar is `pnpm verify` (fast lane, mirrors the CI `verify` job) and `pnpm gauntlet` (full). Tier map: light = verify/claims/contracts/fuzz*/web-stories/moderator; merge = + chart/cluster-smoke/tracetest/web-component; nightly = + load/mutation/evomaster/chaos; evals (golden/DeepEval/DeepTeam) run on the cron or a dispatch with `run_evals: true`.

The merge bar (enforced by the dispatched lanes, and required of any PR before merge) is:

1. Unit, property, integration, and contract tests pass (`pnpm test`).
2. Lint and type-check pass (`pnpm lint`, `pnpm typecheck`).
3. `oasdiff` reports no undeclared breaking changes.
4. `test-results/summary.json` is produced and validates against its frozen schema. The terminal `summary-envelope` job fans every lane's evidence partial into one envelope; missing key/cluster lanes are deferred, not fatal.
5. PR description includes the required sections (What, Why, Test plan, Demonstration if introducing a technique).

## Where to ask "is this in scope?"

If a change feels like it crosses an architectural commitment, read `docs/adr/0001-foundational-decisions.md` and check the rejected alternatives. The deliberate exclusions list is in [`ARCHITECTURE.md`](ARCHITECTURE.md#7-what-this-architecture-deliberately-omits-and-why) §7 ("What this architecture deliberately omits").

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
- `.claude/skills/` is the canonical location for skills; more land milestone by milestone as patterns emerge.
- When you author a skill: the `description` field in YAML frontmatter determines activation: be specific and signal-dense. Keep body under 500 lines; reference external files for anything longer. Prefer scripts over prose.

### Locked vs open

The 16 + 1 commitments in `docs/adr/0001-foundational-decisions.md` are immutable once code lands. Implementation choices (library versions, file formats, helm chart shape) are open and made milestone by milestone. If unsure which category a question lives in, ask before proposing.
