import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { SnapshotStore } from '@qaroom/service-kit'
import type { DonationsDb } from './db/client'
import type { PaymentClient } from './payment-client'

/** What `buildApp` receives. `lamport`/`sink` are optional; `payment` is the injectable seam. */
export interface DonationsDeps {
  db: DonationsDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  payment: PaymentClient
  lamport?: LamportGate
  sink?: SpanAttributeSink
  /** Scenario-replay store (Commitment 8). When present, /system/snapshot is registered. */
  snapshotStore?: SnapshotStore
}

/** What route handlers receive: every dependency resolved. */
export interface RouteDeps {
  db: DonationsDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  payment: PaymentClient
}

/** Subset the repository needs. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
  payment: PaymentClient
}
