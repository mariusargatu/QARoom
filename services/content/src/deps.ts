import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { SnapshotStore } from '@qaroom/service-kit'
import type { ContentDb } from './db/client'

/**
 * The deliberate-bug fault switches, resolved once from the environment at the boot boundary
 * (`config/faults.ts`) and injected like `clock`/`ids`/`randomness` — never read from `process.env`
 * inside business logic. content is the intentional fleet exception: these stay UNGUARDED (no
 * `NODE_ENV` gate, unlike flags/webhooks) because the live detection-matrix and the
 * `outbox-isolates-broker-latency` claim arm them on the deployed pod. See `config/faults.ts`.
 */
export interface FaultConfig {
  /** Sort the feed oldest-first instead of newest-first (regression demo). */
  feedReversed: boolean
  /** Loosen listFeed's per-community scope to an always-true predicate (tenant-leak demo). */
  tenantLeak: boolean
  /** Inject a fixed delay (ms) into the vote write path (SLO-regression demo). 0 = off. */
  voteSlowMs: number
  /** Drain the outbox on the request path, undoing the relay's isolation (chaos demo). */
  syncPublish: boolean
  /**
   * Write an out-of-range vote value (instead of the validated ±1) so the ±1 invariant is violated
   * on demand. The DB CHECK (votes_value_check) rejects it and the vote-value property test goes
   * red — the empirical falsifier for the `vote-value-in-band` claim. 0/false = off.
   */
  voteOutOfRange: boolean
}

/** What `buildApp` receives. `lamport` and `faults` are optional; the app fills sane defaults. */
export interface ContentDeps {
  db: ContentDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge (Milestone 3). */
  sink?: SpanAttributeSink
  /** Scenario-replay store (Commitment 8). When present, /system/snapshot is registered. */
  snapshotStore?: SnapshotStore
  /** Deliberate-bug switches; defaults to all-off when absent (a clean production/test build). */
  faults?: FaultConfig
}

/** What route handlers receive: every dependency resolved, including the gate and faults. */
export interface RouteDeps {
  db: ContentDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  faults: FaultConfig
}

/** Subset the repository needs to mint ids, stamp time, advance the gate, and read fault switches. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
  faults: FaultConfig
}
