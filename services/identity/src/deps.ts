import type { LamportGate } from '@qaroom/contracts'
import type { Clock, IdGenerator, Randomness } from '@qaroom/determinism'
import type { IdentityDb } from './db/client'
import type { Issuer } from './jwt'
import type { KeyMaterialSource, KeyStore, RotationConfig } from './keys'

/** What `buildApp`/`buildIdentity` receives. `lamport`, `rotation`, `tokenTtlSeconds` optional with defaults. */
export interface IdentityDeps {
  db: IdentityDb
  clock: Clock
  ids: IdGenerator
  randomness: Randomness
  lamport?: LamportGate
  keyMaterial: KeyMaterialSource
  rotation?: RotationConfig
  tokenTtlSeconds?: number
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
}

/** Subset the repository needs to mint ids, stamp time, and advance the gate. */
export interface RepoDeps {
  clock: Clock
  ids: IdGenerator
  lamport: LamportGate
}

export const DEFAULT_TOKEN_TTL_SECONDS = 3600
