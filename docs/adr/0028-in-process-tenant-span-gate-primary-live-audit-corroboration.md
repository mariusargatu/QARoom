# ADR 0028: In-process tenant-span gate as the primary check; live audit as corroboration

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** the relocation of the *authoritative, every-PR* enforcement of Commitment 9 ("every span carries `tenant.id`") from the cluster-only live Jaeger audit to a cheap in-process gate, while keeping the live audit as broader cluster-tier corroboration. Adds a new always-green in-process claim; does **not** weaken or remove the existing live `tenant-span-everywhere` claim. **Does not modify any ADR-0001 commitment** (Commitment 9 stands — this strengthens the *availability* of its enforcement).
- **Touches invariant sources** (`scripts/lib/manifests/claims.ts`, `scripts/lib/manifests/detection-matrix.ts`) → requires Code Owner sign-off per AGENTS.md before it leaves `Proposed`.

## Context

Commitment 9's headline crown-jewel — *every span the system emits carries `tenant.id`* — has its only authoritative gate on the **live cluster**: `scripts/check-tenant-spans.ts` queries the Jaeger v2 HTTP API after traffic has run, and the `tenant-span-everywhere` falsifiable claim (`claims.ts:279`, evidence runner `tenant-spans`, gate `check:tenant-spans`) is backed by it. The matching detection-matrix toggle `tenant-span-drop` (`detection-matrix.ts:74`) names that live audit as its `designatedCatcher`.

Two problems follow, both observed:

1. **The most important invariant is the least continuously enforced.** When the cluster is down, `claims:verify` reds on `tenant-span-everywhere` — the recurring "tenant-span THEATER". The crown-jewel's primary signal is gated behind `tilt up`, so a regression introduced on a normal PR is invisible until someone brings a cluster up. The cheap-proxy/expensive-truth ordering is inverted.

2. **But in-process is NOT a drop-in for the live check.** The live audit proves a property of the *deployed distributed system*: it catches a span emitted by a service that bypassed the processor, a `tenant.id` lost across a NATS context-propagation hop, or a newly added service never held to the gate. An in-process test of `packages/otel/src/tenant-span-processor.ts` (which already exists at `tenant-span-processor.test.ts`) only proves *the stamping function stamps*. The live check catches a **strictly broader** bug class. Naively "promote the in-process test to authoritative and demote the live audit" would trade down real surface to buy availability — precisely the Goodhart move this architecture exists to refuse.

So the honest position: part of this crown-jewel's C grade (availability) is **intrinsic** — "every span in the deployed system" cannot be fully proven in-process. The fix is not to pretend otherwise, but to make the cheap proxy strong and continuous *without* letting it impersonate the deployed-system guarantee.

## Decision

1. **Add a strong in-process, every-PR gate** as the *primary* tenant-span signal:
   - the existing `tenant-span-processor.test.ts` (the stamp function), plus
   - a new per-service "every span emitted on a real request flow carries `tenant.id`" assertion driving requests through the service with an OpenTelemetry `InMemorySpanExporter` and asserting over `getFinishedSpans()`. This catches the common regression class (a handler/route that emits an unstamped span, a service wired without the processor) in the cheap CI job.
2. **Keep `scripts/check-tenant-spans.ts` (live Jaeger audit) unchanged**, as cluster-tier **corroboration**. It remains the only check for the cross-service/propagation/whole-fleet class, and keeps its `--break` falsifier teeth.
3. **Manifest change (additive — weakens nothing):**
   - The existing `tenant-span-everywhere` claim and its live `tenant-spans`/`check:tenant-spans` gate stay exactly as they are (cluster tier).
   - **Add** a new in-process claim (`tenant-span-stamped-in-proc`) whose gate is the in-process test runner and whose teeth arm `CHAOS_TENANT_SPAN_DROP` against the processor — green on every PR, red when the stamp is dropped.
   - The `tenant-span-drop` detection-matrix toggle gains the in-process test as a second, in-proc `designatedCatcher` alongside the live audit (it already lists the processor test under `selfToggling`).

The two claims are deliberately not merged: one asserts the cheap, always-on stamp property; the other asserts the expensive, deployed-system property. Collapsing them would re-introduce exactly the conflation this ADR avoids.

## Consequences

- **Crown-jewel availability: C → B/B+, not A+.** The common regression class is now caught on every PR with no cluster; the THEATER symptom is gone for that class. It is *not* A+ because the deployed-system property (propagation, new-service coverage) genuinely still needs the live tier — that ceiling is intrinsic, and claiming A+ would be dishonest.
- **No surface lost.** Every bug class the live audit caught, it still catches. The in-process gate is strictly additive.
- **Governance:** this edits two invariant-source manifests, so it needs a Code Owner sign-off and its own ADR (this one) per AGENTS.md; the invariant and its implementation are not changed in the same commit — this ADR lands first, the implementation follows on sign-off.
- **Determinism / fidelity tension acknowledged:** the in-process gate is a real-but-narrower proxy. It is documented as such in both claims so a reader never mistakes the cheap green for the deployed-system guarantee.

## Alternatives rejected

- **Promote in-process to authoritative, drop/demote the live audit.** Rejected: trades down the caught bug class for an availability number — the textbook measure-becomes-target failure.
- **Leave it cluster-only.** Rejected: keeps the crown-jewel's primary enforcement gated behind `tilt up`, the inversion this ADR exists to fix.
- **One merged claim spanning both tiers.** Rejected: conflates a cheap always-on property with an expensive deployed-system property; the merged claim's green would be ambiguous.
