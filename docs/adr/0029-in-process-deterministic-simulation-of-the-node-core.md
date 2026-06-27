# ADR 0029: In-process deterministic simulation of the Node core, bounded at the bolted-on LLM edge

- **Status:** Proposed
- **Date:** 2026-06-27
- **Records:** a further increment of Commitment 8's *scoped* deterministic simulation — composing the
  Node services' real logic + event protocol in **one process** against a simulated bus + per-service
  PGlite + a virtual clock, driven by one seed. Builds on the determinism trio (Commitment 6), the
  observable-state envelope (Commitment 7), scenario replay ([ADR-0015](0015-scenarios-as-first-class-artifacts.md)),
  the ports/adapters service shape, and the delivery XState + `spec/tla/WebhookDelivery.tla` oracles.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). **Reaffirms** its rejection of full
  Antithesis-style / hypervisor DST. Implements more of Commitment 8, not a new commitment.
- **Relates to:** ADR-0015 (scenario replay — the prior increment), ADR-0018 (the moderator proposes,
  never enforces), ADR-0019 (webhooks delivery edge), ADR-0024 (invariant sources).

## Context

The principal-level review named DST "the last gap in the architecture." Grounding the claim against the
repo changed its shape: **the gap is composition, not capability.**

1. **~80% of the primitives already exist** and are lint-enforced: the injected `Clock`/`IdGenerator`/
   `Randomness` (a direct `new Date()`/`Math.random()`/`crypto.randomUUID()` is a P0 defect), PGlite
   in-process DBs, `brokerDouble`, `failingDb`, `runTwiceAndDiff`, and one `fc.commands` stateful test.
2. **Node makes the hardest DST requirement free.** The single-threaded deterministic execution that
   forced Go to fork its runtime + compile to WASM, FoundationDB to invent the Flow actor language, and
   Rust to use libc-override shims is *the default* in Node — JS runs on one thread. Two further freebies:
   JS `Map`/object iteration is **insertion-ordered** (the HashMap-iteration leak that bit s2.dev/Polar
   Signals does not exist here), and ambient entropy is **already banned**.
3. **The leak audit is favorable.** The only real-timer leak in production *logic* is the relay/worker
   poll (`packages/messaging/src/drain-loop.ts` `setInterval`), and it already exposes a `drainOnce()`
   escape hatch — the pipeline can run on virtual-clock ticks today. Every `AbortSignal.timeout` lives in
   an I/O **adapter** (the HTTP clients) that the sim replaces with an existing double (`mock-upstream`,
   `sender-http-fake`). No `process.nextTick`/`queueMicrotask` fiddling — microtask order is deterministic.
4. **The moderator-agent (Python/LLM) was deliberately bolted on** to mirror the now-universal pattern:
   a team appends an LLM feature to a previously-deterministic system. That makes it the **natural DST
   kernel boundary** — the deterministic core stays inside the simulation; the appended non-deterministic
   LLM edge is stubbed and named. This is a property of the specimen, not a shortcoming: it shows how to
   keep DST honest *exactly when* an organization grafts an LLM onto a deterministic core.

## Decision

1. **The DST kernel = the Node services' business logic + event protocol + fault response,** composed in
   one process on a shared in-memory bus + per-service PGlite + one `FakeClock`, driven by one seed.
   Delivered as a ladder: single-service slice (T20, webhooks) → two-service composition (T22,
   content→webhooks).
2. **Drive the relay/worker via `drainOnce()` on virtual-clock ticks.** Add an optional `TimerFactory`
   seam to `createDrainLoop` so the loops themselves advance on the `FakeClock`, and **lint-ban raw
   `setTimeout`/`setInterval` in non-test `src`** (the way `new Date()` is banned). ~30 lines, backward-compatible.
3. **Oracles, reused:** the delivery XState reverse-conformance + `WebhookDelivery.tla` + property
   invariants; a same-seed-replay **meta-test** (extend `runTwiceAndDiff` to the composed fingerprint);
   on failure persist `seed + git-commit` for exact replay.
4. **The kernel boundary is drawn at the bolted-on LLM edge.** The moderator is stubbed as a seeded NATS
   consumer (it proposes, never enforces — ADR-0018 — so it is off the deterministic critical path; its
   LLM is already faked with `ZeroEmbedder`/`RuleKeywordLlm`).
5. **Named un-simulatable edges (the deliverable, house style):** real NATS redelivery semantics, real
   Postgres MVCC/visibility, OS scheduler preemption, and the Python moderator + real LLM. The
   live-cluster gauntlet is the **"Sinkhole"** that validates the sim model against reality (FoundationDB
   ran a real-hardware Sinkhole cluster for exactly this reason).

## Consequences

- **Gained:** bit-for-bit reproducible cross-service bugs in the deterministic core; seed-fuzzed fault
  exploration; an Elle-style transactional-history check over the in-process op-log (cheap *because* the
  history is deterministic — far cheaper than over a real cluster; see planning T19).
- **Not claimed:** full Antithesis-style whole-system DST. Real broker/DB/OS internals and the Python
  edge stay outside the kernel. The honest framing in every doc: *"in-process logic/protocol DST of the
  deterministic core, bounded at the LLM edge — limits named."*
- **Cost:** an additive test-only harness + one small `TimerFactory` seam + a richer in-memory broker
  (~200 LOC). No production rewrite — the ports/adapters + determinism trio + `drainOnce` + build/listen
  split already provide every seam.

## Rejected alternatives

- **Full Antithesis-style DST / a deterministic hypervisor.** Out of scope (multi-year; Node/polyglot
  hostility; real-broker/DB/OS determinism). Reaffirms ADR-0001's rejection.
- **Rewriting services into a single-threaded actor model** (FoundationDB Flow / Dropbox Nucleus path).
  Unnecessary — the existing hexagonal seams already deliver single-process composition.
- **Forcing the Python moderator into the sim.** Wrong boundary. It is the deliberate LLM-append edge;
  the right move is to stub it and name it.

## Invariant guard

Extends Commitment 8 without modifying ADR-0001; needs Code-Owner sign-off (ADR-0024 / `invariant-guard`).
`spec/**` (`WebhookDelivery.tla`) and the claims manifest stay invariant sources — a red seed is a real
finding, never a reason to weaken the spec or its falsifier.
