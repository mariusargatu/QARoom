# QARoom documentation map

A guide to what lives in `docs/`, grouped by why you'd open it. New here? The fastest paths are
[START-HERE.md](../START-HERE.md) (a guided tour) or [getting-started](getting-started.md) (making a
change). The one-page landscape is the root [ARCHITECTURE.md](../ARCHITECTURE.md).

## Start here

- [getting-started.md](getting-started.md) — the on-ramp: one idea → one schema edit → the gates go green.
- [code-tour.md](code-tour.md) — one request followed hop by hop, each boundary and the test that guards it, with `file:line` anchors.
- [testing-guide.md](testing-guide.md) — how the tests are organized and how to judge their quality (strong exemplars, gate blind spots, what to distrust).
- [add-a-field.md](add-a-field.md) — the mechanical recipe behind getting-started.

## The evidence (does the testing actually work?)

- [claims.md](claims.md) — every guarantee, its deliberate bug, and the command that breaks it (`pnpm prove`).
- [detection-matrix.md](detection-matrix.md) — every seeded bug × every technique: catch or honest miss.
- [gauntlet.md](gauntlet.md) — running every technique at once against the live system, gate vs observe.
- [evidence/](evidence/) — captured run artifacts referenced by the claims.

## The decisions

- [adr/](adr/README.md) — 41 Architecture Decision Records, each with its rejected alternatives. [ADR-0001](adr/0001-foundational-decisions.md) is the immutable foundation.
- [structurizr/](structurizr/) — the C4 model + testing model, source for the [published architecture site](https://mariusargatu.github.io/QARoom/architecture/).

## The testing model & operating discipline

- [operating-model.md](operating-model.md) — where this discipline costs, rubs, and is the wrong choice.
- [reward-model.md](reward-model.md) — how agents are scored: a trust budget, not a presubmit tick.
- [incident-to-claim.md](incident-to-claim.md) — the ritual that turns an incident into a new falsifiable claim.
- [severity-oracle-independence.md](severity-oracle-independence.md) — ranking boundary checks by oracle independence.
- [consistency-verification.md](consistency-verification.md) — TLA+, MBT×fault, Elle, and DST.
- [stress-experiment.md](stress-experiment.md) — the 100-feature agentic stress test.

## Reliability & operations

- [slos.md](slos.md) — the service-level objectives the load lane gates against.
- [failure-modes.md](failure-modes.md) — each chaos experiment paired with its expected-behavior assertion.
- [disaster-recovery.md](disaster-recovery.md) — the DR posture (a named v1 gap, disclosed honestly).

## Feasibility record

- [spikes/](spikes/) — how each technique was vetted before it earned its place (Milestone 0).

## Folded pointers

`02-architecture.md`, `03-testing-strategy.md`, `04-roadmap.md`, `05-conventions.md` are short **redirect
stubs** kept for inbound links — their content was folded into [ARCHITECTURE.md](../ARCHITECTURE.md), the
[ADRs](adr/README.md), and the enforced convention gates. Follow the stub to the live source.
