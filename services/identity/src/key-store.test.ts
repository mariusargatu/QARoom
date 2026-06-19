import { pgliteRows, type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestKeyMaterialSource } from '../tests/fixtures/test-key-material'
import type { IdentityDb } from './db/client'
import { ensureSchema } from './db/migrate'
import { KeyStore } from './keys'

/**
 * The signing-key store and rotation authority (ADR-0008). Rotation continuity is property-tested
 * end-to-end; these pin the store's own contracts: mint-on-first-use, the per-key grace window in
 * `jwksEligible`, the `verifyKeyFor` resolution rules, and the security-critical guarantee that the
 * published JWKS never leaks a private `d`. Grace is evaluated against the injected Clock.
 */
const GRACE_MS = 1000

let ctx: RepoTest<IdentityDb>
let keyStore: KeyStore

const keyCount = () =>
  pgliteRows<{ n: number }>(ctx.db, sql`SELECT count(*)::int AS n FROM signing_keys`).then(
    (r) => r[0]?.n ?? 0,
  )

beforeEach(async () => {
  ctx = await setupRepoTest<IdentityDb>({ applyMigrations: (db) => ensureSchema(db) })
  keyStore = new KeyStore(ctx.db, ctx.clock, ctx.ids, new TestKeyMaterialSource(), {
    graceMs: GRACE_MS,
  })
})

afterEach(async () => {
  await ctx.close()
})

describe('KeyStore.current', () => {
  it('mints exactly one current key on first use and returns the same key on the next read', async () => {
    const first = await keyStore.current()
    expect(await keyCount()).toBe(1)

    const second = await keyStore.current()
    expect(second.kid).toBe(first.kid)
    expect(await keyCount()).toBe(1)
  })
})

describe('KeyStore.rotate', () => {
  it('demotes the current key to previous and mints a distinct new current', async () => {
    const old = await keyStore.current()
    const rotated = await keyStore.rotate()

    expect(rotated.kid).not.toBe(old.kid)
    expect((await keyStore.current()).kid).toBe(rotated.kid)
  })
})

describe('KeyStore.jwksEligible grace window', () => {
  it('keeps a rotated-out key while it is inside its grace window', async () => {
    const old = await keyStore.current()
    const fresh = await keyStore.rotate()

    // Advance to JUST inside the grace window so grace duration is actually exercised — without an
    // advance the filter collapses to `graceMs >= 0` and a grace-too-short (graceMs→0) mutant survives.
    ctx.clock.advance(GRACE_MS - 1)

    const eligible = await keyStore.jwksEligible()
    expect(eligible.map((k) => k.kid).sort()).toEqual([old.kid, fresh.kid].sort())
  })

  it('drops a rotated-out key once its grace window closes, keeping only the current', async () => {
    await keyStore.current()
    const fresh = await keyStore.rotate()

    ctx.clock.advance(GRACE_MS + 1)

    const eligible = await keyStore.jwksEligible()
    expect(eligible.map((k) => k.kid)).toEqual([fresh.kid])
  })
})

describe('KeyStore.verifyKeyFor', () => {
  it('resolves a previous kid inside grace, but rejects unknown, undefined, and past-grace kids', async () => {
    const old = await keyStore.current()
    await keyStore.rotate()

    // Inside grace (clock advanced into the window so grace duration is load-bearing): old kid resolves.
    ctx.clock.advance(GRACE_MS - 1)
    expect(await keyStore.verifyKeyFor(old.kid)).not.toBeNull()
    expect(await keyStore.verifyKeyFor(undefined)).toBeNull()
    expect(await keyStore.verifyKeyFor('key_unknown')).toBeNull()

    // Past grace: the previous kid is no longer a valid verification key.
    ctx.clock.advance(GRACE_MS)
    expect(await keyStore.verifyKeyFor(old.kid)).toBeNull()
  })
})

describe('KeyStore.publishJwks', () => {
  it('publishes only public key material — never the private d component', async () => {
    const current = await keyStore.current()

    const jwks = await keyStore.publishJwks()

    expect(jwks.keys.length).toBe(1)
    expect(jwks.keys[0]?.kid).toBe(current.kid)
    expect(Object.keys(jwks.keys[0] ?? {})).not.toContain('d')
  })
})
