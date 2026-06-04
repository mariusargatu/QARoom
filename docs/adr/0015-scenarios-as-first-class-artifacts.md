# ADR 0015 — Scenarios as first-class testing artifacts; the limits of replay without a hypervisor

- **Status:** Accepted
- **Date:** 2026-06-04
- **Records:** how QARoom captures and replays scenarios (Milestone 7, Commitment 8). Implements
  Commitment 8 of [ADR-0001](0001-foundational-decisions.md) without modifying it; builds on the
  observable-state envelope (Commitment 7) and the determinism trio (Commitment 6).

## Context

Reproducing a distributed-system bug usually means either luck (it happened again) or a
heavyweight deterministic simulator (Antithesis-style) that QARoom explicitly rejected as out of
scope. The middle path: capture *enough* state to replay a scenario deterministically — and be
honest, up front, about what that scope cannot reproduce. The limits are the deliverable, not a
footnote.

## Decision

1. **A scenario = each service's domain DB state + its Lamport counter + a clock seed.** Captured
   via `GET /system/snapshot`, restored via `POST /system/snapshot` (service-kit owns the route;
   the DB dump/restore lives behind a `SnapshotStore` so service-kit carries no DB dependency).

2. **App-level JSON dump, not `pg_dump`.** Each service serialises its `public` base tables to
   JSON rows and reloads them (truncate + bulk insert in one transaction with
   `session_replication_role = replica` to bypass FK ordering). Rationale: the bundle is
   human-readable and diffable, needs no Postgres client binary in the replay env, and matches the
   "no hypervisor" framing. The cost: it is row-level, not byte-level — sequences and
   vacuum/visibility state are not preserved (they don't affect observable behaviour here).
   - **Capture is a consistent snapshot.** The per-table dumps run inside one `REPEATABLE READ
     READ ONLY` transaction, so a concurrent write cannot tear the bundle (a vote captured without
     its post).
   - **Two exclusion categories.** `signing_keys`/`sessions` are *never touched* (not dumped, not
     truncated, not inserted). The messaging plumbing (`outbox`/`processed_events`/
     `idempotency_responses`) is *not dumped* but *is reset* (truncated, not re-inserted) on
     restore, so a reused replay env is returned to exactly the captured domain state — it cannot
     serve a stale idempotent response or re-deliver a stale outbox row.
   - **Restore refuses schema skew.** A faithful capture dumps every non-excluded base table
     (empty → `[]`). On restore, the payload's table set must equal the replay env's; a mismatch
     throws a clear error rather than silently truncating a table the payload omits. Capture and
     replay must therefore run the *same* schema — there is no per-service migration-version field
     in the bundle, by design.

3. **The Lamport counter is captured and restored.** It is in-memory (`LamportGate`), so
   reproducing a scenario's `as_of.lamport` requires `LamportGate.restore(counter)` before replay.
   `snapshot_id` is deliberately NOT reproduced — it is documented as a service-local opaque read
   id, never asserted equal. Residual: the counter is read *after* the DB dump transaction returns,
   not inside it, so a write committing in that narrow window could record a `lamport` one ahead of
   the dumped rows. The DB dump itself is internally consistent (point 2); only the counter-vs-rows
   pairing is best-effort, which is acceptable for capturing a quiesced scenario.

4. **Time is pinned on replay via `FixedClock`.** Production reads OS time through `SystemClock`;
   a replay boot (`SNAPSHOT_REPLAY` + the bundle's `clock_seed`) wires a `FixedClock` so
   time-dependent logic is deterministic. The captured rows carry their own timestamps, so
   data-ordering reproduces regardless of the replay clock.

5. **Versioned bundle, append-only.** `SnapshotBundleV1` (Zod, `packages/contracts/snapshot.ts`):
   `manifest.json` + one `<service>.snapshot.json` per service + any chaos manifests captured
   verbatim (Commitment 6). Restore refuses a `schema_version` it doesn't understand (the
   `z.literal`); a future `SnapshotBundleV2` ships alongside, never replaces.

6. **Regression-by-scenario.** A captured deliberate-bug scenario becomes a test: it must
   reproduce the bug under the buggy code (identical order + `as_of.lamport`) and replay green
   after the fix. Run in a Docker tier (the store needs real Postgres, not the pglite unit lane).

## Documented limits (the spine of this ADR)

- **No in-flight HTTP request capture.** A request mid-flight at capture is lost; only committed
  DB state is captured.
- **No JetStream stream restore.** The outbox / `processed_events` / `idempotency_responses` tables
  are transient broker-replay plumbing (and hold jsonb); a scenario captures domain state, not the
  message stream. They are excluded from the dump and reset on restore. Replaying a scenario does
  not replay events through NATS.
- **No private key material, and no captured auth sessions.** identity's `signing_keys` (the jsonb
  JWKs, incl. private keys) is excluded — it must not land in a portable, diffable bundle
  (security), and a replay env mints its own keys. `sessions` is excluded with it: a session's
  `kid` references that un-exported key, so a captured token could never verify against the freshly
  minted key — replay clients re-authenticate rather than resume a captured session. `signing_keys`
  is the only jsonb table that would reach the dump (the messaging plumbing's jsonb columns are
  excluded too); a future service adding a jsonb *domain* column would need real jsonb handling in
  the store — a known limit.
- **Consumer-maintained projections freeze at capture.** donations' `flag_cache` (the gating
  projection a NATS consumer keeps current) is captured as domain state, but the consumer is not
  run in replay (no broker), so gating reflects the captured instant. A scenario that depends on a
  flag flip *arriving mid-sequence* cannot be reproduced. This is fundamental to "no broker in
  replay" — not closeable without re-introducing NATS, which is out of scope.
- **Capture and replay must share the same schema.** The app-level dump carries no per-service
  migration version; restore refuses a payload whose table set differs from the replay env's
  (loud error, no silent data loss), so a schema-skewed replay simply fails fast.
- **No WebSocket session state.** Live connections and their cursors are not captured; clients
  reconnect and re-poll.
- **Row-level, not byte-level.** Sequence values are not reset (`TRUNCATE` without `RESTART
  IDENTITY`; harmless today — all PKs are text ULIDs, no `serial`), and timestamps round-trip at
  millisecond precision (`timestamptz` is microsecond; harmless today — all domain timestamps come
  from the ms-precision `Clock`). Visibility/vacuum state is not preserved.
- **Security + privilege.** `/system/snapshot` reads/replaces the whole database — a dev/replay
  affordance (the system is dev-only, ADR-0009), not for a hardened production deployment. Restore
  also requires a role that may `SET session_replication_role` (superuser/owner), which the local
  `qaroom` role is.

## Consequences

### Positive

- A bug reproduces in a fresh environment from a committed artifact, in seconds, with identical
  observable behaviour — verified live (`pnpm replay:regression`, scenario `feed-order-bug`).
- The bundle is diffable and replayable without a simulator or a Postgres binary.

### Trade-offs

- The store is postgres-js-specific, so scenario tests run in a Docker tier, not the fast unit
  lane. Accepted: they are a merge/PR-tier gate, like the Pact provider verifications.
- Excluding messaging plumbing means a scenario cannot reproduce a bug that depends on un-drained
  outbox rows or in-flight redelivery. Accepted and documented.

## Rejected alternatives

- **Full Antithesis-style deterministic simulation.** Rejected in ADR-0001 — multi-year
  investment; the scoped replay captures the principle (reproducible scenarios) without it.
- **`pg_dump` / `pg_restore`.** Opaque, version-sensitive, couples the bundle to the PG binary;
  loses diffability.
- **Capturing the messaging plumbing tables.** Transient + jsonb; out of scope per the limits.

## Related decisions

- [ADR-0001](0001-foundational-decisions.md) Commitments 6, 7, 8.
- [ADR-0014](0014-chaos-as-property-check.md) — chaos manifests are captured verbatim into the
  bundle (Commitment 6).
- `docs/04-roadmap.md` §Milestone 7.
