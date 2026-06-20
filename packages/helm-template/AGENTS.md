# helm-template

The shared `qaroom-service` Helm chart — ONE chart, N releases (deployed once per service). It
replaced the per-service `chart/` sketches in Milestone 3: every backend is the same shape, so the
shape lives once and each service supplies only values. Read the repo-root `AGENTS.md` first.

## What lives here

- **`templates/`**: `deployment.yaml` (env-wires `PORT`/`NODE_ENV`/`DATABASE_URL`/OTel + probes),
  `service.yaml`, `postgres-statefulset.yaml` + `postgres-service.yaml` (the optional per-service
  Postgres), `gc-cronjob.yaml` (the messaging TTL sweep), `serviceaccount.yaml`, and `_helpers.tpl`
  (naming + the `databaseUrl` helper). No `src/`, no tests — this is a chart, not a pnpm package.
- **`values.yaml`**: the defaults. Each service overrides via **`deploy/<service>/values.yaml`**;
  `values.schema.json` validates the merged result.

## Conventions enforced here

- **Values-driven, never forked.** A new service is a `deploy/<service>/values.yaml`, not a new
  template. `postgres.enabled` toggles the StatefulSet (content/identity = true, gateway = false);
  `_helpers.tpl`'s `databaseUrl` builds the in-cluster DSN when enabled, else uses `database.url`.
- **`gc.enabled` is OFF by default** — only services with the messaging tables enable it. The
  CronJob targets the service's OWN Postgres via the same `databaseUrl` helper (DB isolation) and
  runs `src/jobs/gc-dedup.ts`; it is hygiene only (Commitment 17), never correctness.
- **`image` is a bare name, never a remote pull** — Tilt's `default_registry` rewrites it locally,
  CI uses `kind load` + `pullPolicy: Never`. The plaintext `postgres.password` is dev-only (ADR-0009).
- Edits here ripple to every release; pair any template change with the affected
  `deploy/<service>/values.yaml`. Rendering is gated by the chart-lint / cluster-smoke CI lanes.

## Commands

```bash
helm lint packages/helm-template
helm template demo packages/helm-template -f deploy/content/values.yaml   # render one service
```
