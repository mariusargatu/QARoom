import type { LamportGate, SpanAttributeSink } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { SnapshotStore } from '@qaroom/service-kit'
import type { IdentityDb } from './db/client'
import type { Issuer } from './jwt'
import type { KeyMaterialSource, KeyStore, RotationConfig } from './keys'
import type { TicketStore } from './ticket-store'

/** What `buildApp`/`buildIdentity` receives. `lamport`, `rotation`, `tokenTtlSeconds` optional with defaults. */
export interface IdentityDeps {
  db: IdentityDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  /** Span-attribute sink for the LamportGate; defaults to the active-span bridge (Milestone 3). */
  sink?: SpanAttributeSink
  keyMaterial: KeyMaterialSource
  rotation?: RotationConfig
  tokenTtlSeconds?: number
  /** Scenario-replay store (Commitment 8). When present, /system/snapshot is registered. */
  snapshotStore?: SnapshotStore
}

/** What route handlers receive: every dependency resolved, including the gate, key store, and issuer. */
export interface RouteDeps {
  db: IdentityDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport: LamportGate
  keyStore: KeyStore
  issuer: Issuer
  ticketStore: TicketStore
}

/** Subset the repository needs to mint ids, stamp time, and advance the gate. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
}

export const DEFAULT_TOKEN_TTL_SECONDS = 3600
