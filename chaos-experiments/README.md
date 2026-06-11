# Chaos experiments (Milestone 6)

Chaos as a *property check, not a stunt* (ADR-0014). Each experiment is a committed,
self-contained manifest paired with a TypeScript **steady-state hypothesis** that must hold
both when the system is healthy and during the chaos, plus a **deliberate-mitigation-removal
demo** that turns the assertion red when the documented mitigation is taken away.

## How it runs

```bash
pnpm chaos:install          # Chaos Mesh (helm, pinned) into the cluster, opt-in, not in `pnpm dev`
pnpm chaos:install:litmus   # LitmusChaos operator: only needed for experiments 06 and 08 (HTTP chaos)
pnpm chaos:smoke            # prove injection works against a throwaway pod
pnpm chaos:run              # the TS steady-state harness: apply manifest -> assert -> tear down
pnpm chaos:uninstall        # remove operators (leaves qaroom/observability alone)
```

The harness lives in `packages/testing-utils/src/chaos/`; the per-experiment hypotheses live in
`tests/chaos/<slug>.test.ts`. The manifests here are the **replayable artifact** (Commitment 6):
self-contained and committed, so a run replays from the manifest alone. Milestone 7's snapshot
bundle captures these verbatim into its `chaos_manifests` array.

## The experiments

Each row binds four things that must change together (the "change both or neither" rule extends
to all four): the **manifest** here, the **assertion** in `tests/chaos/`, the **demo toggle**, and
the **`docs/failure-modes.md` anchor**.

| # | Manifest | Engine | Steady-state property | Mitigation | Demo toggle | Status |
|---|----------|--------|-----------------------|------------|-------------|--------|
| 1 | `01-pod-donations-unreachable.yaml` | Chaos Mesh PodChaos | gateway bounded (200/502), self-heals after restart; consumer catches up | durable consumer + dedup; gateway timeout | `GATEWAY_UPSTREAM_TIMEOUT_MS` / `CHAOS_SKIP_DEDUP` | ✅ verified live |
| 2 | `02-net-slow-nats.yaml` | Chaos Mesh NetworkChaos (delay) | request path stays fast; events drain when NATS recovers | outbox-in-tx + async relay | publish-on-request-path | ✅ verified live |
| 3 | `03-net-drop-content-consumers.yaml` | Chaos Mesh NetworkChaos (loss) | content writes stay available; eventual exactly-once delivery | at-least-once + `processed_events` dedup | `CHAOS_SKIP_DEDUP` | ✅ verified live |
| 4 | `04-stress-pg-pool-exhaustion.yaml` | Chaos Mesh StressChaos | bounded under DB pressure (200/502/503), no hang | bounded pool + readiness | `PG_POOL_MAX` unbounded | ✅ verified live |
| 5 | `05-time-clock-skew.yaml` | Chaos Mesh TimeChaos | gateway stays bounded though skew degrades donations (**finding:** skew poisons the PG pool) | gateway timeout; Lamport (not wall-clock) ordering | `GATEWAY_UPSTREAM_TIMEOUT_MS` widened | ✅ verified live, gated `CHAOS_TIMECHAOS=1` |
| 6 | `06-http-gateway-500-donations.yaml` | Litmus HTTPChaos | donations endpoint degrades to a typed retryable 502, never a naked 500 | circuit breaker | `CHAOS_DISABLE_CIRCUIT_BREAKER` | ✅ property proven in-process (`gateway/tests/circuit-breaker.spec.ts`); live Litmus injection nightly |
| 7 | `07-net-partition-gateway-donations.yaml` | Chaos Mesh NetworkChaos (partition) | partition -> prompt 502 `dependency_failure`; p99 bounded | upstream `AbortSignal.timeout` | `GATEWAY_UPSTREAM_TIMEOUT_MS` widened | ✅ verified live (green->red->green demo) |
| 8 | `08-http-receiver-500-webhooks.yaml` | Litmus HTTPChaos | failing receiver -> every due delivery retried on capped jittered backoff, then succeeds or `DeadLettered`; never lost, never double-applied; CRUD + consume paths stay responsive | durable delivery ledger + deterministic retry contract + bounded attempt budget | `CHAOS_WEBHOOK_DROP_ON_FAIL` | ✅ property proven in-process (`services/webhooks/src/delivery-guarantee.property.test.ts`); live Litmus injection nightly |

See `docs/failure-modes.md` for the full expected-behaviour write-up of each.
