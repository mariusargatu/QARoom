# QARoom: Conventions

The conventions in this document are enforced by lint where possible and by review where not. They exist to make the repository legible: to humans, to future-you, and to LLM agents.

## 1. Repository layout

```text
/
├── README.md  # Entry point
├── AGENTS.md  # Agent-specific quick reference
├── CLAUDE.md  # Symlink to AGENTS.md (Claude Code compat)
├── package.json  # Root package, defines workspaces
├── pnpm-workspace.yaml
├── turbo.json
├── .claude/
│   ├── settings.json
│   ├── agents/  # Subagent definitions (empty in v1)
│   └── skills/  # Skills (canonical location; empty in v1)
├── docs/
│   ├── 01-vision.md
│   ├── 02-architecture.md
│   ├── 03-testing-strategy.md
│   ├── 04-roadmap.md
│   ├── 05-conventions.md
│   ├── adr/  # Architecture decision records (immutable)
│   │   └── 0001-foundational-decisions.md
│   │   └── README.md
│   └── failure-modes.md  # Begins in M6
├── packages/
│   ├── contracts/  # Zod schemas, OpenAPI, XState machines
│   ├── messaging/  # Shared NATS + OTel SDK (M4)
│   ├── testing-utils/  # Fixtures, generators, harnesses, matchers, Screenplay
│   │   ├── screenplay/  # Actors, Abilities, Tasks, Questions (M5)
│   │   ├── screenplay-system/  # System Ability bindings (M5)
│   │   ├── screenplay-ct/  # CT Ability bindings + portable-story helpers (M8)
│   │   └── contract-crosscheck/  # Pact ↔ OpenAPI wrapper (M1)
│   └── helm-template/  # Shared Helm chart template (M3)
├── services/
│   ├── gateway/
│   │   ├── AGENTS.md  # Per-service agent reference
│   │   ├── openapi.yaml  # Generated, committed
│   │   ├── src/
│   │   ├── tests/  # Co-located *.test.ts files preferred
│   │   ├── Dockerfile
│   │   └── chart/  # Helm chart
│   ├── content/
│   ├── identity/
│   ├── flags/
│   ├── donations/
│   ├── moderator-agent/  # Python; M9
│   └── web/  # React + Vite frontend; M5
├── chaos-experiments/  # Begins in M6
│   ├── *.yaml
├── scripts/
│   ├── spin-up-ephemeral.sh  # Namespaced env provisioner
│   ├── aggregate-test-results.ts  # Produces test-results/summary.json
│   └── qaroom-replay/  # The CLI; M7
├── Tiltfile
├── k3d-cluster.yaml
└── .github/
    └── workflows/  # CI definitions
```

Things that are conventions:

- **Every service has an `AGENTS.md`** at its root, even if minimal.
- **Every service has an `openapi.yaml`** committed (generated from Zod; do not edit by hand).
- **Every service has a `chart/`** directory with its Helm chart (from Milestone 3 onwards).
- **Tests are co-located** with source: `src/foo.ts` ↔ `src/foo.test.ts`. The `tests/` directory holds only cross-cutting tests (E2E, MBT, integration suites that span multiple modules).
- **The `packages/` directory holds shared code.** Services may depend on packages. Packages may not depend on services.

## 2. Naming conventions

### Files and directories

- `kebab-case` for directories and file names: `donations-service/`, `feature-flags.ts`.
- `PascalCase` for files that primarily export a class or React component: `PostCard.tsx`, `DonationMachine.ts`.
- `*.test.ts` for unit tests; `*.spec.ts` for integration tests; `*.e2e.ts` for Playwright; `*.contract.ts` for Pact.

### Code

- `camelCase` for variables, functions, properties.
- `PascalCase` for types, interfaces, classes, React components, XState machines, XState states.
- `SCREAMING_SNAKE_CASE` for module-level constants that are configuration (e.g., `MAX_POST_LENGTH`).
- `kebab-case` for HTTP endpoints, URL slugs, and CLI commands.

### Domain identifiers

- IDs are typed branded strings: `UserId`, `CommunityId`, `PostId`, `CommentId`, `DonationId`. Never raw `string`.
- IDs are prefixed in storage: `user_01HXYZ...`, `comm_01HXYZ...`, `post_01HXYZ...`. Prefix makes them grep-friendly and reduces foot-guns when IDs are mixed in logs.
- The `IdGenerator` interface emits prefixed ULIDs; tests seed it so IDs are deterministic.
- **Branded IDs are enforced at runtime, not only at compile time.** Every ID enters the system through a Zod parser:

```ts
// packages/contracts/ids.ts
export const UserId = z.string()
  .regex(/^user_[0-9A-HJKMNP-TV-Z]{26}$/)
  .brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;
```

  - DB reads cast through `UserId.parse(row.id)` before the value is handed to business code. Drizzle column types provide compile-time hints; Zod provides runtime enforcement.
  - HTTP and event boundaries parse IDs out of payloads via the schema; no raw string ever flows into a function expecting an `XId`.
  - A test in `packages/contracts/ids.test.ts` enumerates all branded types and verifies the prefix discriminates them (a `UserId` string cannot parse as a `PostId`).

### State machine states

- States are PascalCase nouns or noun phrases: `DonationsOff`, `DonationsEnabling`, `DonationsOn`, `DonationsDisabling`.
- States are named for what is observable, not internal status: `DonationsEnabling` not `WaitingForCachePropagation`.
- Events are PascalCase verbs in past or imperative form: `EnableRequested`, `PropagationConfirmed`, `DisableRequested`.

### Endpoints

- Resource paths are kebab-case: `/api/communities/{community_id}/posts`.
- System endpoints are under `/system/`: `/system/state`, `/system/capabilities`, `/system/snapshot`, `/system/limits`.
- Health and readiness are under `/health` and `/ready`.
- Internal endpoints (used between services, not exposed at the gateway) are under `/internal/`.
- Every mutating endpoint declares OAS `links` to the subsequent operations a caller may follow (e.g., `createPost` links to `getPost`, `listCommunityPosts`). Schemathesis `--stateful=links` depends on these declarations; without them, stateful workflow fuzzing is vacuous.

### NATS subjects

Event subjects encode the tenant explicitly so wildcard subscribers cannot leak across tenants by mistake. Subject grammar:

```text
qaroom.<service>.<entity>.<community_id>.<event>
```

Examples:
- `qaroom.content.posts.comm_01HXYZ.created`
- `qaroom.content.votes.comm_01HXYZ.cast`
- `qaroom.flags.donations.comm_01HXYZ.enabled`
- `qaroom.donations.transactions.comm_01HXYZ.completed`

Rules:
- Every subject includes the `community_id` at fixed position 3. The subject *is* the tenancy boundary at the messaging layer; the payload also carries `tenant.id`, but the subject is the load-bearing guard.
- Tenant-scoped consumers subscribe with the explicit community: `qaroom.content.posts.comm_01HXYZ.>`.
- Cross-tenant consumers (admin tooling, the moderator agent) must use `qaroom.<service>.<entity>.*.<event>` and are subject to a property test asserting they handle every community correctly.
- The `>` wildcard at the end is reserved for service-internal stream definitions; never for application-level subscriptions.
- A subject taxonomy registry lives in `packages/contracts/subjects.ts`, exporting helper builders (`postCreated(communityId)`); raw string literals at call sites fail lint (custom Biome rule `qaroom/no-raw-nats-subject` lands Milestone 4).

### Event schemas

- Every NATS event has a Zod schema named `<Entity><Verb>Event` in `packages/contracts/events/<entity>-<verb>.ts`.
- Adding a non-optional field is a breaking change. Removing a field is a breaking change. Renaming a field is a breaking change.
- Breaking event changes bump the major version; the prior version is frozen as `packages/contracts/events/<entity>-<verb>.v{N}.ts` and a consumer-compatibility test asserts existing consumers still parse v{N} events.
- AsyncAPI YAML is generated from these schemas via `pnpm asyncapi:generate` and committed under `services/<name>/asyncapi.yaml`. Drift gated by the tool selected in Milestone 0.

## 3. Schema and contract conventions

### Zod schemas

- All schemas live in `packages/contracts/` and are exported by name.
- Schema names are PascalCase: `CreatePostRequest`, `CreatePostResponse`.
- Every request schema has a matching response schema. Empty responses are still typed.
- Every error response is a `ProblemDetails` schema (RFC 7807 with extensions).
- Schemas include `.describe()` calls for fields that benefit from documentation. The descriptions flow into OpenAPI.

### OpenAPI

- Generated from Zod by a `pnpm openapi:generate` script. Never hand-edit.
- Committed alongside the service code: `services/<name>/openapi.yaml`.
- Every endpoint has an `operationId` in `camelCase`: `createPost`, `listCommunityPosts`.
- Every endpoint has a `summary` (one line) and a `description` (multiple lines if needed).
- Every endpoint includes at least one example for each response code.

### Versioning

- The OpenAPI document carries a semver in its `info.version`.
- A breaking change (per oasdiff) requires the major version to bump.
- When a major version is released, the YAML is copied to `services/<name>/openapi.v{N}.yaml` and frozen.
- Backward-compatibility CI job: the current implementation must satisfy the previous major version's frozen spec.

### Pact contracts

- Consumer tests author Pact files; they are committed to `services/<consumer>/pacts/`.
- A change to a Pact file shows up as a diff in PR review.
- The Pact ↔ OpenAPI cross-check test runs in PR CI.
- **No Pact Broker in v1.** The monorepo is the exchange surface: provider verification runs `pnpm pact:verify --provider <name>`, which scans `services/*/pacts/` for files referencing the named provider. This trades the broker workflow for atomic monorepo commits; the trade-off is intentional.
- Provider verification runs against a Testcontainers-booted instance of the provider service (real Postgres, real Fastify), not a mocked stub.

### Idempotency

- Every mutating HTTP endpoint requires an `Idempotency-Key` header. Missing header -> 400 with `failure_domain: "validation"`.
- Replays are served from a per-service `idempotency_responses` table keyed by `(idempotency_key, route, body_hash)`. Same key + same body -> return stored response, do not re-execute. Same key + different body -> 409 with `failure_domain: "conflict"` and `next_actions` pointing at the conflicting request.
- The `idempotency_responses` table schema is shipped as a reusable Drizzle migration fragment from `@qaroom/messaging/migrations/`. Every service that exposes mutations applies the fragment.
- Test discipline: every mutating endpoint has a property test asserting that any sequence containing duplicate `Idempotency-Key` requests produces the same observable state as the sequence with duplicates removed.
- **TTL/GC.** Rows in `idempotency_responses` and `processed_events` are deleted by a scheduled job (`pnpm jobs:gc-dedup`) after 24h. The job is hygiene only. Correctness rests on the `Nats-Msg-Id` window and consumer idempotency, not on the GC running on time.

## 4. Error response conventions

All non-2xx responses use `application/problem+json` per RFC 7807, with these required fields plus the three agent-actionable extensions:

```json
{
  "type": "https://qaroom.dev/errors/<machine-readable-slug>",
  "title": "<human-readable summary>",
  "status": <http-status>,
  "detail": "<context-specific explanation>",
  "instance": "<the URL path that produced the error>",
  "retryable": <boolean>,
  "next_actions": [
    {"verb": "GET|POST|...", "href": "<url>", "description": "<what this would accomplish>"}
  ],
  "failure_domain": "<category>"
}
```

Failure domains are a closed enum, defined in `packages/contracts/errors.ts`. The initial set:
- `validation`: input does not match the schema
- `authentication`: caller is not who they claim to be
- `authorization`: caller is not allowed to perform this action
- `tenant_resolution`: community ID does not exist or caller is not a member
- `rate_limit`: caller exceeded their allowance
- `conflict`: operation conflicts with current state (e.g., feature flag mid-transition)
- `not_found`: resource does not exist
- `dependency_failure`: a downstream service or external dependency failed
- `internal_error`: unexpected; investigate

## 5. Testing conventions

These are detailed in `docs/03-testing-strategy.md`. The conventions enforced as code rules:

- No `toMatchSnapshot()` or any snapshot matcher anywhere in the codebase. Caught by lint.
- No direct `new Date()` in non-test code. Use the injected `Clock`. Caught by lint.
- No direct `Math.random()` or `crypto.randomUUID()` in non-test code. Use the injected `Randomness` or `IdGenerator`. Caught by lint.
- No conditional logic in tests (`if`, `try/catch` for assertion purposes). Caught by lint.
- Tests must use the shared generators in `packages/testing-utils/generators/` for domain objects rather than constructing them inline.
- **Test names describe the property or invariant, not the function name.** A custom Biome plugin rule (`qaroom/test-name-shape`) enforces this in Milestone 0: `it.skip|describe.skip` excepted; otherwise titles like `"foo() works"`, `"returns correctly"`, `"happy path"`, `"basic test"`, and single-verb titles fail lint. If Biome plugin support is not yet shipped at Milestone 0, an ESLint sidecar runs in lint-only mode with the same rule set, and the migration to Biome lands when feasible.
- **Every Drizzle migration ships with an `up`, a `down`, and an idempotency test** in `services/<name>/migrations/<n>.test.ts`. The test runs: apply up, apply down, apply up again, apply up again (no-op assertion), and asserts the schema matches the expected snapshot at each step. Caught by CI (PR fails if a migration lacks its test).

## 6. Documentation conventions

### AGENTS.md authoring

- Repo root `AGENTS.md`: ≤ 200 lines. Per-service `AGENTS.md`: ≤ 80 lines. Caught by lint.
- Commands come first. Conventions come second. Architecture pointers come last.
- "Do not touch" paths are explicit.
- Negative rules ("never commit `.env`") are as important as positive rules.

### ADR authoring

- One ADR per architectural decision. Format: title, status, context, decision, consequences, rejected alternatives.
- ADRs are numbered sequentially: `0001-`, `0002-`, ...
- ADR titles use the form `ADR NNNN: Title`; ADR-0001 predates the rule and stays as the documented exception.
- ADRs are immutable once accepted. Superseding an ADR is a new ADR that explicitly references the old one.

### In-code documentation

- TSDoc comments on every exported function, type, and class.
- TSDoc descriptions are written in present tense, describing what the thing *is*, not what it *does* mechanically.
- `@example` blocks for non-trivial functions.

### Diagrams

- Mermaid for diagrams that live in markdown.
- For diagrams complex enough to need a tool (state machines), use Stately Studio's URL embedded in the doc.
- ASCII diagrams allowed when they're clearer than Mermaid (e.g., the container view in `02-architecture.md`).
- Prose docs use ASCII `->` for flow arrows, never `→`.

## 7. Commit and PR conventions

### Skills

Skills live in `.claude/skills/` (single canonical location). Earlier draft prose referenced `docs/skills/`; that path is **not** used. Add new skills to `.claude/skills/<skill-slug>/SKILL.md`.

### Commit messages

Conventional Commits format: `<type>(<scope>): <description>`, where `(scope)` is **optional**.

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`.

Scope is optional: add the service or package name when it sharpens the subject (`feat(content): add post deletion`); a bare `feat:` / `docs:` is fine for repo-wide or cross-cutting changes.

Subjects are **descriptive, not milestone-numbered.** Never put "Milestone N" in a commit subject. Milestones belong to the roadmap; a subject like "Milestone 1: gateway" implies a fixed ordering and rots when history is reorganized. Name the change itself (`feat: the first defended boundary`), not its roadmap slot.

### PR titles and descriptions

- Title matches the conventional commit format of the squash commit.
- Description has three sections: **What** (one paragraph), **Why** (one paragraph), **Test plan** (a list). For PRs that introduce a new testing technique, also include a **Demonstration** section: the deliberate-bug scenario that proves the technique works.
- If the PR changes a contract, the description explicitly notes it.

### CI gates

GitHub Actions are dispatch-only (`.github/workflows/ci.yml`): no `push`/`pull_request` trigger. CI is run on demand from the Actions tab at a cumulative `tier` (`light` < `merge` < `nightly`), and one weekly `schedule` cron — the only automatic trigger — fires the keyed eval tier alone. Locally the same bar is `pnpm verify` (fast lane) and `pnpm gauntlet` (full). The merge bar (run by the dispatched lanes, required of any PR before merge) is:

- All tests in the "fast" and "full" feedback loops pass (per `docs/03-testing-strategy.md`, section 8).
- `oasdiff` reports no undeclared breaking changes.
- `test-results/summary.json` is produced and validates against its frozen schema. The terminal `summary-envelope` job fans every lane's evidence partial into one envelope; absent key/cluster lanes are deferred, not fatal.
- The PR description is non-empty and includes the three required sections.

## 8. Style and formatting

- Biome handles formatting and linting. No manual style debates.
- 2-space indentation.
- Single quotes for strings in TS; double quotes in JSON.
- Trailing commas everywhere.
- Maximum line length 120 characters, but the linter does not enforce a hard cap.

## 9. Dependencies

- New runtime dependencies require an explicit decision in the PR description.
- New dev dependencies are looser but should be considered.
- Dependency upgrades are batched weekly via Renovate (configured in Milestone 0).
- Lockfile (`pnpm-lock.yaml`) is committed.

## 10. Forbidden patterns

These are bugs, not stylistic issues. Each is enforced by lint where possible.

- Direct database access from one service to another's database. Services own their data.
- Catching errors without re-throwing or producing a typed problem-details response.
- Mutating function arguments.
- Module-level mutable state outside of pure constants.
- Singleton clients that hold per-request context (request IDs, tenant IDs, traces).
- Hidden retries inside service-to-service clients. Retries belong at the call site and are configured per call.
- "Magic" abstractions: framework decorators that hide what would otherwise be explicit code paths.
- Any file longer than 500 lines, including tests. Caught by lint. Two exceptions:
  - Generated artifacts marked `// @generated` (OpenAPI YAML, Drizzle migration scaffolds, code emitted by build scripts, and EvoMaster black-box suites under `services/*/tests/evomaster-generated/`) are exempt and counted against a separate, untracked budget. The EvoMaster output is also gitignored and lint-ignored: a disposable nightly review artifact, never hand-edited (Milestone 8, ADR-0016).
  - Hand-authored files may exceed via a `// biome-ignore lint/style/maxFileLength` comment with a tracking issue. The baseline is 500; the threshold may be raised later when concrete examples justify it.
- Barrel exports (`index.ts` that re-exports many modules) for non-public APIs.
- Untyped JSON in NATS event payloads. Every event has a Zod schema and a name.
- Untyped `any` in non-test code. `unknown` is preferred when type information is genuinely absent.

## 11. What this document is not

This is not a tutorial. It does not explain what Biome, Zod, Drizzle, or any other tool *is*. It assumes the reader knows. The conventions are the contract; the rationales are in the ADRs and the strategy document.

If you find yourself wanting to add a rule to this document, write the rule, write the enforcement (lint, CI gate, or "by review"), and write the rationale in a one-line PR. Conventions earn their place by being enforced; conventions that are not enforced rot.
