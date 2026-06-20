# ADR 0009: Kubernetes, and how we keep dev fast

- **Status:** Accepted
- **Date:** 2026-06-03
- **Records:** how QARoom migrated from Docker Compose to k3d + Tilt + Helm and brought OpenTelemetry online in Milestone 3, and the decisions that keep the inner loop fast and telemetry determinism-safe. Implements ADR-0001 Commitments 1 (Kubernetes), 7 (observable state), 12 (OpenTelemetry, GenAI semconv), and the `tenant.id`-on-every-span half of Commitment 9. Does not modify any commitment.

## Context

Milestones 0–2 ran on Docker Compose + `tsx`. Commitment 1 fixes Kubernetes (k3d local, KinD in CI) as the target; Commitment 12 fixes OpenTelemetry across all services with manual NATS-ready propagation primitives. The migration is itself the demonstration: the existing 160 tests must still pass, and a deliberately broken Helm value must be caught by a `/health` smoke test. The risk is that a teaching repo's K8s milestone balloons into unreadable infra and a slow inner loop. Every decision below is in service of "minimal, readable, fast."

## Decision

**k3d local, KinD in CI; Tilt as the inner loop.** `scripts/bootstrap-k3d.sh` creates a single-node k3d cluster + a local image registry (Traefik disabled: no Ingress in M3; Tilt port-forwards instead). `pnpm dev` = bootstrap + `tilt up`; `pnpm dev:down` tears both down. CI uses KinD (`helm/kind-action`) with `kind load` instead of the k3d registry.

**Fast inner loop = `live_update` + `restart_process`.** Tilt syncs `src/` into the running container and re-runs `tsx` without an image rebuild (~1s warm reload). The cold first build installs deps (Docker layer-cached afterwards). The "`tilt up` < 2 min" exit criterion is interpreted as the warm path; the cold build is documented as slower. `node:24-slim` has a shell, which `restart_process` requires.

**One shared `qaroom-service` Helm chart, three releases** (`packages/helm-template/` + `deploy/<service>/values.yaml`). Deployment + Service + ServiceAccount + an optional per-service Postgres StatefulSet (Commitment: domain state lives in each service's own DB). A `values.schema.json` type-checks values at `helm template` (Helm v4). This supersedes the per-service `services/*/chart/` sketch in the original layout: a single generic chart cannot live in three places. The app Deployment + Service carry a `qaroom.io/component: app` selector label so the Service never round-robins onto the Postgres pods (a bug caught during live bring-up).

**Hand-authored minimal observability, not umbrella charts.** `deploy/observability/` holds thin manifests: an OpenTelemetry **Collector** (the single egress; services export OTLP to it), **Jaeger v2** all-in-one (itself a Collector distro with native OTLP ingest: runs with sane defaults, no config file), **Prometheus**, and **Grafana** (provisioned datasources). kube-prometheus-stack / the Jaeger operator would pull hundreds of MB and many pods: unacceptable for the laptop-fast budget and unreadable for a teaching repo. The roadmap says "minimal: just enough to demonstrate."

**Telemetry via a collector, started from an ESM preload.** Each service runs the OpenTelemetry NodeSDK from a `tsx --import ./src/telemetry.ts` preload: required so http/fastify auto-instrumentation patches those modules *before* the entry module imports them (an ESM correctness requirement, not a style choice). Services export OTLP/HTTP to the Collector, which fans out to Jaeger (traces) and Prometheus (metrics). GenAI semantic conventions are opted in now (`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`) to set the precedent before the Milestone-9 LLM agent.

**`tenant.id` is stamped on every span, not just HTTP roots.** A custom `TenantSpanProcessor.onStart` reads the ambient community id from an `AsyncLocalStorage` store (set by a Fastify `onRequest` hook from the `communityId` path param) and stamps `tenant.id` on every span the SDK creates: root, child, DB, outbound. Non-tenant work (boot, `/system/*`, `/health`) gets the `system` sentinel, so the "every span has `tenant.id`" invariant has no holes. We chose a SpanProcessor over a response hook because only `onStart` sees every span. Verified live: a smoke flow produced 153 spans across the three services with **zero** missing `tenant.id`; `scripts/check-tenant-spans.ts` queries the Jaeger API and fails CI on any offender. The `LamportGate`'s Milestone-0 `SpanAttributeSink` seam is now bridged to the active span (`qaroom.lamport` lands on spans), replacing the no-op without changing the gate's contract.

**Telemetry is determinism-safe.** OTel runs only at bootstrap; under `NODE_ENV=test` the SDK is a no-op and tests use an in-memory exporter via an explicit seam, so the 160 unit/property/integration/contract tests stay deterministic and unchanged (zero test edits). Trace/span IDs come from the OTel SDK's internal RNG (a dependency, like `ulid`/`jose`), are out of the `Clock`/`IdGenerator`/`Randomness` scope, and are never asserted on or persisted, so introducing OTel does not violate Commitment 6 and the determinism lint rules stay green.

**DB spans without a stale dependency.** There is no actively-maintained OpenTelemetry auto-instrumentation for porsager `postgres` (the one on npm was ~11 months stale against the current OTel 2.x SDK). Rather than gamble on it, DB-call depth comes from an explicit `traced()` helper at the repository seam (using only the stable `@opentelemetry/api`). Honest gap, full control, no stale dep: the same intellectual-honesty stance as the Milestone-4 async-fuzz gap.

**Latest stable, resolve-then-pin.** Every dependency and image is pinned to the latest stable resolved at implementation time (June 2026): OTel-JS api 1.9.1 / sdk-node 0.218.0 / stable 2.x, Collector-contrib 0.153.0, Jaeger v2 2.17.0, Prometheus 3.12.0, Grafana 13.0.2, and **Postgres bumped 16 -> 18-alpine repo-wide** (chart + compose + Testcontainers), with the provider-verification suite re-run to prove the bump broke nothing.

## Consequences

### Positive
- One command (`pnpm dev`) brings the whole system + observability up on a fresh clone; the existing tests held the line through the migration.
- A wrong `service.targetPort` is caught by `scripts/smoke.sh` (and a CI negative test), not discovered in production: the migration's demonstration.
- Traces are visible end-to-end in Jaeger with `tenant.id` on every span; the collector is the single egress, so swapping a backend touches no service config.

### Negative / trade-offs accepted
- Per-service Postgres = two extra pods on a laptop cluster; justified by fidelity to the per-service-DB architecture M4+ assumes.
- Dev-only plaintext Postgres/Grafana passwords in values: documented as NOT production; a real deployment uses a secrets manager behind the same values.
- No DB auto-instrumentation for postgres-js: DB spans are explicit (`traced()`) on the hot paths only.
- Hand-authored observability means we own the manifests (vs. a maintained chart): accepted for readability + speed; revisit if it grows.

## Rejected alternatives
- **kube-prometheus-stack / Jaeger operator**: too heavy and too opaque for a laptop teaching cluster.
- **Services export straight to Jaeger**: re-plumbing when M4 needs collector-side processing; the collector is the seam now.
- **Jaeger v1 all-in-one**: v2 is the latest stable and runs with sane defaults; v1 kept only as a documented fallback.
- **A stale community postgres-js OTel instrumentation**: compatibility gamble against OTel 2.x; explicit `traced()` spans instead.
- **Body-level `startTelemetry()` in `server.ts`**: ESM import hoisting makes it too late for auto-instrumentation; the `--import` preload is mandatory.
- **Ingress in M3**: Tilt/KinD port-forwards suffice; no Ingress earns its place yet.

## Related decisions
- [ADR-0001](0001-foundational-decisions.md): Commitments 1, 7, 9, 12.
- [ADR-0007](0007-communities-as-tenants-shared-schema-discriminator.md) / [ADR-0008](0008-jwt-signing-key-model-and-rotation-contract.md): the tenancy + identity boundaries now traced with `tenant.id`.
- `AGENTS.md` "Milestone awareness" (Milestone 3); `packages/otel/AGENTS.md`; `docs/slos.md`.
