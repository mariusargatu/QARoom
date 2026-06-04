import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { SnapshotStore } from '@qaroom/service-kit'
import type { ContentDb } from './db/client'

/** What `buildApp` receives. `lamport` is optional; the app creates one if absent. */
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
}

/** What route handlers receive: every dependency resolved, including the gate. */
export interface RouteDeps {
  db: ContentDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
}

/** Subset the repository needs to mint ids, stamp time, and advance the gate. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
}
