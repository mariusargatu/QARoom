import { Jwks } from '@qaroom/contracts'
import type { Clock, IdGenerator } from '@qaroom/determinism'
import { advisoryLock } from '@qaroom/messaging'
import { eq, inArray } from 'drizzle-orm'
import { exportJWK, generateKeyPair, type JWK } from 'jose'
import type { IdentityDb, SqlExecutor } from './db/client'
import { signingKeys } from './db/schema'

export type KeyStatus = 'current' | 'previous' | 'retired'

export interface StoredKey {
  kid: string
  alg: string
  publicJwk: JWK
  privateJwk: JWK
  status: KeyStatus
  createdAt: Date
  retiredAt: Date | null
}

/** Raw ES256 key material (exported JWKs). */
export interface KeyMaterial {
  publicJwk: JWK
  privateJwk: JWK
}

/**
 * Injectable source of ES256 key material (Commitment 6 seam). Production generates a
 * fresh keypair; tests inject a fixed committed keypair so JWKS output and signatures
 * are byte-reproducible. Key generation is the one crypto touch and lives behind this
 * seam, exactly like SystemClock / CryptoRandomness.
 */
export interface KeyMaterialSource {
  generate(): Promise<KeyMaterial>
}

/** Production ES256 key material via jose. */
export class ProductionKeyMaterialSource implements KeyMaterialSource {
  async generate(): Promise<KeyMaterial> {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
    return { publicJwk: await exportJWK(publicKey), privateJwk: await exportJWK(privateKey) }
  }
}

export interface RotationConfig {
  /** How long a rotated-out 'previous' key remains JWKS-eligible. 24h prod, 1h test (ADR-0008). */
  graceMs: number
}

export const DEFAULT_ROTATION: RotationConfig = { graceMs: 24 * 60 * 60 * 1000 }

function rowToStoredKey(row: typeof signingKeys.$inferSelect): StoredKey {
  return {
    kid: row.kid,
    alg: row.alg,
    publicJwk: row.publicJwk,
    privateJwk: row.privateJwk,
    status: row.status as KeyStatus,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
  }
}

/**
 * The signing-key store and rotation authority (ADR-0008). Keys live in Postgres as JWKs.
 * Grace is evaluated against the injected logical Clock, never wall-clock, so rotation
 * continuity is deterministically testable by advancing a FakeClock.
 */
export class KeyStore {
  readonly #db: IdentityDb
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #source: KeyMaterialSource
  readonly #graceMs: number

  constructor(
    db: IdentityDb,
    clock: Clock,
    ids: IdGenerator,
    source: KeyMaterialSource,
    config: RotationConfig = DEFAULT_ROTATION,
  ) {
    this.#db = db
    this.#clock = clock
    this.#ids = ids
    this.#source = source
    this.#graceMs = config.graceMs
  }

  get graceMs(): number {
    return this.#graceMs
  }

  /** Build a fresh signing-key row (pure, no I/O): a new material set + a deterministic kid. */
  async #buildKey(status: KeyStatus): Promise<StoredKey> {
    const material = await this.#source.generate()
    const kid = this.#ids.next('key')
    const publicJwk: JWK = {
      kty: 'EC',
      crv: 'P-256',
      x: material.publicJwk.x,
      y: material.publicJwk.y,
      kid,
      use: 'sig',
      alg: 'ES256',
    }
    return {
      kid,
      alg: 'ES256',
      publicJwk,
      privateJwk: material.privateJwk,
      status,
      createdAt: this.#clock.now(),
      retiredAt: null,
    }
  }

  /** Serialize current-key mutations on a per-resource advisory lock (single-writer, Commitment 4). */
  async #lockCurrent(tx: SqlExecutor): Promise<void> {
    await advisoryLock(tx, 'signing_keys:current')
  }

  /** The current signing key, minting one on first use if the store is empty. */
  async current(): Promise<StoredKey> {
    const rows = await this.#db
      .select()
      .from(signingKeys)
      .where(eq(signingKeys.status, 'current'))
      .limit(1)
    const r = rows[0]
    return r ? rowToStoredKey(r) : this.ensureCurrent()
  }

  /** Ensure exactly one current key exists; returns it. */
  async ensureCurrent(): Promise<StoredKey> {
    return this.#db.transaction(async (tx) => {
      await this.#lockCurrent(tx)
      const existing = await tx
        .select()
        .from(signingKeys)
        .where(eq(signingKeys.status, 'current'))
        .for('update')
        .limit(1)
      const found = existing[0]
      if (found) return rowToStoredKey(found)
      const key = await this.#buildKey('current')
      await tx.insert(signingKeys).values(key)
      return key
    })
  }

  /** The JWKS-eligible keys: the current key plus any 'previous' key still inside its grace window. */
  async jwksEligible(): Promise<StoredKey[]> {
    const rows = await this.#db
      .select()
      .from(signingKeys)
      .where(inArray(signingKeys.status, ['current', 'previous']))
    const nowMs = this.#clock.now().getTime()
    return rows
      .map(rowToStoredKey)
      .filter(
        (k) =>
          k.status === 'current' ||
          (k.retiredAt !== null && k.retiredAt.getTime() + this.#graceMs >= nowMs),
      )
  }

  /** Resolve a kid to a verification key, but only within the JWKS-eligible set (rejects unknown/past-grace). */
  async verifyKeyFor(kid: string | undefined): Promise<StoredKey | null> {
    if (kid === undefined) return null
    const eligible = await this.jwksEligible()
    return eligible.find((k) => k.kid === kid) ?? null
  }

  /** Rotate: demote the current key to 'previous' (grace starts now) and mint a new current. */
  async rotate(): Promise<StoredKey> {
    return this.#db.transaction(async (tx) => {
      await this.#lockCurrent(tx)
      await tx
        .update(signingKeys)
        .set({ status: 'previous', retiredAt: this.#clock.now() })
        .where(eq(signingKeys.status, 'current'))
      const key = await this.#buildKey('current')
      await tx.insert(signingKeys).values(key)
      return key
    })
  }

  /** The published JWKS (public keys only; `.strict()` Jwk guarantees no private `d` leaks). */
  async publishJwks(): Promise<Jwks> {
    const eligible = await this.jwksEligible()
    return Jwks.parse({ keys: eligible.map((k) => k.publicJwk) })
  }
}
