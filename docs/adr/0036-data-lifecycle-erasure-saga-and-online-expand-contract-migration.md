# ADR 0036: Data-lifecycle — a cross-service GDPR erasure saga and online expand/contract migration (T14)

- **Status:** Proposed
- **Date:** 2026-06-28
- **Records:** two data-lifecycle decisions. (1) `DELETE /api/users/{id}` is a **GDPR right-to-erasure
  saga** orchestrated as a state machine: identity-service deletes its own user data and stages one
  `user.erased` event **per community** the user belonged to; content- and donations-service consume
  those and delete their slice; the saga tracks **per-service completion** to a terminal state. The
  cascade is idempotent (DELETE is naturally idempotent; the consumer `processed_events` dedup makes a
  redelivery a no-op). (2) A **migration-safety test** that proves an **online expand/contract** column
  evolution (add nullable column → backfill → enforce NOT NULL) holds against a 10k-row populated table
  using only non-blocking forms. It also **NAMES the disaster-recovery posture** ([docs/disaster-recovery.md](../disaster-recovery.md))
  as a conscious v1 gap rather than a built feature.
- **Does not modify** [ADR-0001](0001-foundational-decisions.md). Purely additive: a new typed event
  (`UserErasedEvent`) + subject builder, a new context-free saga machine (`erasureMachine`) + runner, a
  `DELETE` endpoint, per-service erase handlers, one new falsifiable claim (`user-erased-everywhere`)
  with one deliberate-bug toggle (`CONTENT_BUG_SKIP_ERASURE`) and a matrix entry, and identity adopting
  the transactional-outbox fragment so it becomes a producer. It **weakens no existing claim, schema,
  frozen event version, or the migration machine**: the existing `migrationMachine` and every frozen
  `*.v1` event are untouched, and the new event is v1-only. Per the repo's invariant rule, a red
  introduced here is a finding to fix, never a rule to loosen.
- **Relates to:** Commitment 9 (communities-as-tenants — the erasure cascade is decomposed per tenant so
  the subject grammar's `community_id`-at-position-3 boundary stays intact), Commitment 17 (the
  transactional outbox + dedup the cascade rides), [ADR-0029](0029-in-process-deterministic-simulation-of-the-node-core.md)
  and **T22** (the in-process cross-service composition pattern this saga test reuses), and the
  migration discipline harness ([packages/testing-utils/src/harness/migration-discipline.ts](../../packages/testing-utils/src/harness/migration-discipline.ts))
  this extends from table-level to column-level.

## Context

QARoom had **no erasure path**: `services/identity/src/contract/operations.ts` exposed create/get only, no
service deleted a user, and no cross-service cascade existed. A real platform must be able to honour a
GDPR erasure, and erasure is a genuine **distributed-correctness** problem — the user's personal data is
spread across identity (users, memberships, sessions), content (posts, votes), and donations
(donations). Deleting it in one service is easy; deleting it **everywhere**, idempotently, and *knowing*
it happened, is the hard part — exactly the kind of cross-service guarantee the architecture exists to
test.

Separately, migration discipline existed only at the **table** level (`up`/`down`/idempotent table
presence). There was no test that a **column** evolution against a **populated** table is online —
zero-downtime — which is where real migrations bite.

## Decision

### 1. The erasure saga (identity orchestrates; content + donations cascade)

`DELETE /api/users/{userId}` (Idempotency-Key required, RFC 7807 on non-2xx) calls `eraseUser`, which in
**one transaction**: advisory-locks the user (single-writer), captures the user's memberships, deletes
the user's identity-local rows (sessions, memberships, the user), and stages **one `user.erased` event
per community** on the transactional outbox. It returns **202 Accepted** with the saga id and the
communities being cascaded — the cross-service settle is asynchronous.

The event subject is `qaroom.identity.user.<community_id>.erased`. A user-global erasure is thus
**decomposed into per-tenant events**, which keeps `community_id` at the fixed position 3 (the
messaging-layer tenancy boundary, Commitment 9). content- and donations-service each bind a durable to
`qaroom.identity.user.>` and, on each event, delete that community's slice of the user — content removes
the user's posts and their votes (votes carry no `community_id`, so they are scoped through the post),
donations removes the user's donations. Each handler runs through `processEvent`, so its effect commits
exactly-once over at-least-once delivery: a **redelivered** erasure event is deduped on the event id and
is a no-op (and DELETE is idempotent regardless).

The **saga machine** (`packages/contracts/src/machines/erasure.machine.ts`) is context-free and
invoke-free like every other QARoom machine (`Requested → Cascading → Erased | Incomplete`, with
`Incomplete → Cascading` re-drivable). The runner (`erasure.runner.ts`) drives it and **tracks
per-service completion** — confirmation means a service's footprint for the user is now zero, not merely
that its handler ran. That distinction is what makes the demo honest: a disabled handler runs and acks
but does **not** confirm, so the saga reaches `Incomplete` and names the blocking service.

**flags-service is a NAMED non-participant.** Its tables are keyed by `(community_id, flag_key)` and hold
no user-scoped rows, so there is nothing to erase. The saga does not route to it; this is recorded here
so a future reader does not mistake the omission for a gap.

### 2. The `user-erased-everywhere` claim and its toggle

The cross-service saga is driven **end-to-end in-process** — identity (with its real outbox relay),
content, and donations composed over the in-memory broker, three PGlite databases, one virtual clock
(the T22 pattern) — so the guarantee is **Tier-A**, no cluster required. The claim asserts *no service
returns the erased user after the saga settles*. `CONTENT_BUG_SKIP_ERASURE` arms content's handler to
ack without deleting; content then still returns the user, the saga reaches `Incomplete`, and the
property reds. `pnpm prove user-erased-everywhere --break` reds on demand.

### 3. Online expand/contract migration safety

`services/content/migrations/0002-online-expand-contract.test.ts` seeds a **10k-row** posts table and
evolves it through the three-phase online pattern, each step a non-blocking form:

- **EXPAND** `ADD COLUMN` nullable, no default — instant, no table rewrite; existing rows read NULL.
- **BACKFILL** `UPDATE … WHERE col IS NULL` — restartable/idempotent; row locks only, reads proceed.
- **CONTRACT** `ADD CONSTRAINT … CHECK (col IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT` — the
  add is instant; `VALIDATE` scans **without** `ACCESS EXCLUSIVE`, so readers/writers are never blocked.

The deliberately-**avoided** form is `ALTER COLUMN … SET NOT NULL`, which takes `ACCESS EXCLUSIVE` and
full-scans against readers. The test pins the safe shape: the full row set reads at every phase, the
backfill touches all 10k rows, and the validated constraint then rejects a NULL.

## Consequences and NAMED limitations

- **Membership-driven fan-out.** The cascade is driven by the user's **memberships**. Data left in a
  community whose membership was already removed is not reached and needs a separate sweep — a conscious
  v1 boundary, not an oversight.
- **Orphaned references.** Deleting a user's posts can leave *other* users' votes referencing a
  now-deleted post. Those are not the erased user's data, so erasure does not touch them; referential
  cleanup is a separate concern.
- **Production wiring vs. proof.** The erase handlers, dedup, outbox, saga machine + runner, and the
  per-service completion tracking are real, tested code. The saga is **proven** in-process; the
  deployed-topology relay/consumer boot is the standard "integration surface, not in the test loop"
  (the same status as every other QARoom consumer). A central ack-over-NATS coordinator (so identity
  observes completion in production, not just in the composed test) is the named next step.
- **Disaster recovery is NAMED, not built.** See [docs/disaster-recovery.md](../disaster-recovery.md):
  the `pg_dump`/restore strategy, retention policy, and restore-drill cadence are a conscious v1 gap.
  Erasure (a deliberate, audited deletion) and DR (recovery from accidental loss) are distinct
  lifecycle concerns; v1 builds and tests the former and documents the posture of the latter.
