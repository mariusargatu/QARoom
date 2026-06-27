# ADR 0034: Observability hardening — PII-free spans, a consumer-lag SLO, and tested alert rules (T09 + T12)

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** the decision to close three observability-plane gaps as one slice: (T09) spans must be
  **PII-free** and that must be *audited*, not assumed; (T09) the Prometheus **alert rules** that watch
  the SLOs must themselves be **tested**, with every threshold derived from the SLO source; and (T12)
  the async path needs a **consumer-lag SLO** so a durable consumer falling behind is a *defined,
  caught* failure mode rather than a silent one.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). It is purely additive: one new
  invariant value (`CONSUMER_LAG_SLO` in the codeowned `packages/contracts/src/slos.ts`), two new
  falsifiable claims with two deliberate-bug toggles, an alert-rule generator + drift gate + promtool
  suite, a metric-exposure scaffold, and a collector-level redaction processor. It **weakens no
  existing claim, schema, SLO, or falsifier** — per the repo's invariant rule, a red introduced here is
  a real finding to fix, never a rule to loosen.
- **Relates to:** [ADR-0024](0024-verifiable-invariants-single-source-enforced-at-the-boundary.md) (the
  single-source / derive-everywhere discipline this follows for the SLO bound),
  [ADR-0028](0028-in-process-tenant-span-gate-primary-live-audit-corroboration.md) (the in-process
  primary / live corroboration split this reuses for the PII audit),
  [ADR-0011](0011-async-dedup-outbox-msgid-processed-events.md) (Commitment 17 async edge — whose
  **accepted async-fuzz gap** this ADR re-affirms, see below), and the `k6:gen` one-source projection
  (`scripts/k6-gen-thresholds.ts`) the alert generator mirrors.

## Context

Commitment 9 already pins `tenant.id` onto **every** span and a mature live audit
(`scripts/check-tenant-spans.ts`) proves it. But the telemetry plane had three unguarded edges:

- **PII in telemetry (T09).** Nothing stopped a service from stamping a user's email or a post body
  onto a span. `tenant.id` is *audited present*; the inverse — that nothing *personal* rides along —
  was neither audited nor defended.
- **Untested alert rules (T09).** `prometheus.yaml` scraped metrics but carried no `alerting` /
  `rule_files`: there were no SLO alerts at all, and so nothing testing that an alert fires at its
  threshold. An alert rule is code; untested code that watches your SLOs is a false sense of safety.
- **No consumer-lag SLO (T12).** The poison/DLQ path is built and tested (`settle.ts`,
  donations/gateway/moderator) — that is **not** re-touched here. The real gap was *backpressure*:
  no `num_pending` / ack-age bound, so a moderator falling behind a burst had **no defined failure
  mode**. The synchronous path has SLOs (`SLO_TARGETS`); the asynchronous one did not.

## Decision

### 1. PII-free spans, audited (T09)

The single source for "what counts as PII on a span" is `packages/otel/src/pii.ts`
(`findPiiInAttributes`: an email-shaped value, or a denied body/identifier key; `tenant.id` is a
*tenancy* key, deliberately not PII). Two surfaces consume it, never disagreeing:

- the **in-process gate** (the `pii-free-spans` claim) drives a real in-memory tracer and asserts no
  exported span carries PII — keyless, runs on every PR (the **primary**, ADR-0028 shape);
- the **live Jaeger sweep** (`scripts/check-pii-spans.ts`) is the **corroborating Tier-B audit** —
  reachable only on a running cluster, so it is *named and deferred*, the mirror of the tenant-span
  live audit.

The falsifiable seam is `PiiLeakProbe` (toggle `CHAOS_SPAN_PII`): armed, it stamps an email-shaped
attribute onto every span and the audit reds — the exact mirror of `CHAOS_TENANT_SPAN_DROP`. It is
**NODE_ENV-gated**: a PII-injection switch must be inert on a production pod. The standing production
defense is a collector-level `attributes/redact-pii` processor (`otel-collector.yaml`) that scrubs the
known-PII keys before export; its key list mirrors `PII_ATTR_DENYLIST` (the audit's source).

### 2. A consumer-lag SLO + tested alert rules, both derived from one source (T09 + T12)

`CONSUMER_LAG_SLO` (`maxPending`, `maxAckAgeMs`) joins `SLO_TARGETS` in the codeowned `slos.ts` as a
new **invariant source**, applied per durable consumer. Everything downstream *derives* from it:

- the runtime breach check `evaluateConsumerLag` (the in-process backpressure gate);
- the Prometheus **alert thresholds** — `scripts/gen-alert-rules.ts` projects `SLO_TARGETS` (error-rate
  + p95 latency for the write-heavy/read-heavy representatives) **and** `CONSUMER_LAG_SLO` into
  `deploy/observability/alerts.gen.yaml`, the same one-source pattern as `k6:gen`. A drift test
  (`scripts/gen-alert-rules.test.ts`, in the always-on `test:scripts` lane) fails the build if the
  committed rules drift from the source, so an alert threshold can never be a hand-typed copy of an SLO.

The **alert rules are tested**: `deploy/observability/alerts.test.yaml` is a `promtool test rules`
suite that arms each metric past its SLO-derived threshold and asserts the rule fires (and a
below-threshold series does not). The **backpressure failure mode** is now defined: lag past
`CONSUMER_LAG_SLO` → `ConsumerLagPendingHigh` / `ConsumerLagAckAgeHigh` fire. The lag itself is exposed
as OTel gauges (`registerConsumerLagMetrics`, metric names the alerts watch); the **live** feed —
polling `consumers.info()` against a running JetStream each scrape — is **Tier-B** (needs a cluster),
so it is named and scaffolded here, not run. The `consumer-lag-bounded` claim (toggle
`CHAOS_CONSUMER_STALL`) is the keyless in-process teeth: stall the consumer, the backlog and oldest-
unacked age climb past the bound, the gate reds.

## The async-fuzz gap stays an accepted gap (T12)

[ADR-0011](0011-async-dedup-outbox-msgid-processed-events.md) accepted that there is no
Schemathesis-for-async: the message-level oracle (what a *correct* consumer must do) is not expressible
in AsyncAPI, so a generative async fuzzer would have nothing to assert against. This ADR does **not**
ship one and does **not** reopen that decision. Consumer-lag is a *backpressure SLO*, not a fuzzer;
naming it here keeps the boundary honest — the gap is still the gap (Specmatic is the closest named
tool; in-process property tests over the consumer remain the substitute).

## Tier split (what is and is not run on a PR)

| Capability | Tier A (in-process, keyless, every PR) | Tier B (named, deferred — needs a cluster) |
|---|---|---|
| PII-free spans | `pii-free-spans` gate over a real in-memory tracer | live Jaeger PII sweep (`check-pii-spans.ts`) |
| Consumer-lag SLO | `consumer-lag-bounded` gate (deterministic backlog model) | live `num_pending` via `consumers.info()` + alert firing |
| Alert rules | SLO-derivation + drift gate (`test:scripts`) | `promtool test rules` (promtool not in the PR lane) |

## Consequences

### Positive
- The telemetry plane is now guarded on both sides: `tenant.id` present (Commitment 9) **and** PII
  absent, each with a falsifiable audit.
- Alert thresholds can no longer drift from the SLOs they watch, and the alert rules themselves are
  testable — the SLO source is the only place a number is written.
- The async path has a defined backpressure failure mode; a stalled consumer is caught, not silent.

### Trade-offs accepted
- Two new deliberate-bug toggles widen the demo surface. Accepted: each is census-pinned to a single
  read site and backs a `prove --break` claim.
- The strongest live teeth (Jaeger PII sweep, live JetStream lag, promtool firing) are Tier-B and run
  only on a cluster. Accepted and **labelled honestly** — the in-process gates are the keyless teeth;
  the live audits corroborate (ADR-0028 shape).
- A generative async fuzzer is still **not** shipped (ADR-0011) — named, not closed.

## Related decisions
- [ADR-0024] single-source invariants — `CONSUMER_LAG_SLO` follows it; alert threshold + runtime gate derive from one bound.
- [ADR-0028] in-process primary / live corroboration — the PII audit reuses that split.
- [ADR-0011] the accepted async-fuzz gap this ADR re-affirms rather than closes.
