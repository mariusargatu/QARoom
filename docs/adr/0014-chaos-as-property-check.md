# ADR 0014: Chaos as a property check, not a stunt; why Chaos Mesh and Litmus together

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** how QARoom does chaos engineering (Milestone 6): the steady-state-hypothesis
  discipline, the assertion mechanism, and why two chaos tools coexist. Does **not** modify any
  ADR-0001 commitment; builds on [ADR-0009](0009-kubernetes-and-keeping-dev-fast.md) (the k3d
  cluster), [ADR-0010](0010-sync-vs-async-and-otel-propagation-contract.md), and
  [ADR-0011](0011-async-dedup-outbox-msgid-processed-events.md) (the dedup mitigation
  experiment 03 removes).

## Context

Chaos engineering degrades into theatre when it just "breaks things in prod and watches." QARoom
already *documents* its failure behaviour as contract: RFC 7807 problems carry a closed
`failure_domain` plus `retryable`, readiness flips to a 503 `dependency_failure`, consumers
dedupe via `processed_events`, the write path is decoupled from the broker by the outbox. The
value of chaos here is to **verify those documented behaviours hold under real infrastructure
fault**, a property check, not to discover that "something breaks."

Two tool constraints shape the decision. Chaos Mesh is the mature CRD-driven injector for
Pod/Network/Stress/Time faults, but its **HTTPChaos is unreliable on k3d's flannel CNI** (the
documented Milestone 6 risk). And the existing test ecosystem is uniformly TypeScript + Vitest
with shared matchers (`expectRFC7807`) and `test-results/summary.json`: a second, opaque
assertion language embedded in CRDs would fight that grain.

## Decision

1. **Every experiment is a steady-state hypothesis.** Each `chaos-experiments/<slug>.yaml` is
   paired with a TypeScript hypothesis in `tests/chaos/<slug>.test.ts` that must hold in the
   **healthy baseline AND during the fault** (and ideally after recovery). A hypothesis asserts a
   *documented* observable: "2xx, or a typed retryable 502, within a bounded budget; never a
   naked 5xx, never a hang", never the vacuous "no errors". The harness
   (`@qaroom/testing-utils/chaos`) samples the probe before -> inject -> during -> heal -> after.

2. **The assertion authority stays in TypeScript.** Even the Litmus-injected experiment asserts
   its steady state in TS, reusing `expectRFC7807` and the port-forward pattern from
   `scripts/smoke.sh`. Native Litmus/Chaos-Mesh probes are the *injection* mechanism only.

3. **Chaos Mesh for infra faults, Litmus for HTTP.** Chaos Mesh covers experiments 01–05 and 07
   (Pod/Network/Stress/Time). Experiment 06 (HTTP 5xx injection) uses **LitmusChaos** because
   Chaos Mesh HTTPChaos is broken on k3d flannel. This is the entire reason two tools coexist;
   neither is redundant. *(Confirmed empirically in Milestone 6: an HTTPChaos response-replace to
   500 reaches `desiredPhase: Run` but leaves donations' responses unmodified on this k3d/flannel
   cluster. The experiment-06 property is therefore proven in-process against the real breaker
   while the live Litmus injection is a nightly task, since Litmus 3.x is the heavy ChaosCenter
   platform rather than a thin operator.)*

4. **The manifest is the replayable artifact (Commitment 6).** Each experiment YAML is
   self-contained and committed, so a run replays from the manifest alone. TimeChaos
   reproducibility comes from recording the manifest (targets, skew, duration), not measured
   drift; Milestone 7's snapshot bundle captures these verbatim into `chaos_manifests`.

5. **Each experiment ships a deliberate-mitigation-removal demo.** Removing the documented
   mitigation (timeout, circuit breaker, dedup, bounded pool, injected clock, outbox decoupling)
   turns the matching hypothesis red; restoring it returns green. The toggles are env-driven
   (`GATEWAY_UPSTREAM_TIMEOUT_MS`, `CHAOS_DISABLE_CIRCUIT_BREAKER`, `PG_POOL_MAX`,
   `CHAOS_SKIP_DEDUP`) so the demo is a redeploy, not a code edit.

6. **k3d is chaos-ready from bootstrap.** `scripts/bootstrap-k3d.sh` sets
   `--kubelet-arg=allowed-unsafe-sysctls=*` (always on; it only *permits* the `SYS_TIME`/
   `SYS_BOOT` sysctls TimeChaos needs), and `chaos-daemon` runs against the k3s containerd
   socket `/run/k3s/containerd/containerd.sock`. Operators install via `pnpm chaos:install`,
   **never** under `pnpm dev`; chaos runs nightly, and the inner loop pays nothing for it.

> **Note (Milestone 11, non-normative).** This ADR's M6 enumeration is `01–05` and `07` (Chaos Mesh)
> plus `06` (Litmus). Milestone 11 added experiment `08` (webhook-receiver HTTP 500), which follows
> decision 3's Litmus-for-HTTP pattern unchanged: its steady state is proven in-process
> (`services/webhooks/src/delivery-guarantee.property.test.ts`) with live Litmus injection nightly,
> exactly as experiment 06. No part of the decision changes; the chaos count is gated by
> `pnpm chaos:verify`.

## Consequences

### Positive

- Chaos failures are *contract* failures: a red hypothesis names a documented behaviour that
  stopped holding, not a vague "instability".
- One assertion language across the whole portfolio; chaos results ride the frozen
  `summary.json` schema via its extensible per-runner `output`.
- Replayable from committed YAML; no SaaS, no external broker, no measured-drift fragility.

### Trade-offs

- The TS harness must own its own `kubectl port-forward` (Tilt's forwards stop when `tilt ci`
  exits) and poll the experiment to `desiredPhase=Run` before the during-chaos probe, or the
  probe races the fault. Encapsulated in `@qaroom/testing-utils/chaos`.
- Two chaos tools to install and pin. Accepted: the flannel HTTPChaos gap is real and Litmus's
  footprint is kept minimal (operator only, no ChaosCenter portal).
- Live chaos needs a full cluster; it is a nightly tier, not a PR gate.

## Rejected alternatives

- **Gremlin (SaaS).** Cost, and a run cannot be replayed from the repo, contradicts
  "replayable from the manifest alone".
- **No chaos / table-top only.** Loses the verification that mitigations actually fire under
  fault; the deliberate-bug demos would be untestable.
- **Service-mesh fault injection (Istio/Linkerd).** Adds a mesh the architecture deliberately
  omits (`docs/02-architecture.md`); far too heavy for the teaching goal.
- **Native Litmus/Chaos-Mesh probes as the assertion.** A second opaque assertion language;
  cannot express response-*shape* invariants (RFC 7807) and buries the property inside the CRD,
  breaking "replay from the manifest" and TS-ecosystem consistency.

## Related decisions

- [ADR-0009](0009-kubernetes-and-keeping-dev-fast.md): the k3d/Tilt/Helm cluster chaos targets.
- [ADR-0011](0011-async-dedup-outbox-msgid-processed-events.md): the dedup/outbox mitigations
  experiments 01–03 exercise.
- `docs/failure-modes.md`: the per-experiment expected-behaviour spec (change both or neither).
- `docs/04-roadmap.md` §Milestone 6.
