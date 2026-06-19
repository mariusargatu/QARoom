import { createRelay, type TxRunner } from '@qaroom/messaging'
import { injectClient, pgliteRows, setupServiceTest } from '@qaroom/testing-utils/harness'
import { expectRFC7807 } from '@qaroom/testing-utils/matchers'
import {
  brokerDouble,
  type FailMatcher,
  failingDb,
  runTwiceAndDiff,
} from '@qaroom/testing-utils/scenario'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { ensureSchema } from '../src/db/migrate'
import { asContentDb } from './db-cast'
import { SAMPLE } from './harness'

/**
 * content-service scenario catalog (UNIT-L1-PLAN.md §7): inject the faults PGlite can never produce
 * — a down broker, a failing DB — and assert the two halves of the contract. EXPECTED faults surface
 * as typed RFC 7807 (never a bare 500); broker-down proves the transactional outbox conserves the
 * event (Commitment 17). One scenario also runs twice + diffs to PROVE determinism.
 */
type ScenarioCtx = Awaited<ReturnType<typeof setup>>

async function setup(faultDb?: FailMatcher) {
  const test = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) => {
      const base = asContentDb(deps.db)
      return buildApp({
        db: faultDb ? failingDb(base, faultDb) : base,
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
      })
    },
  })
  return { ...test, request: injectClient(test.app) }
}

const createPost = (request: ScenarioCtx['request'], key = 'k1') =>
  request.post(
    `/api/communities/${SAMPLE.communityA}/posts`,
    { author_id: SAMPLE.user, title: 't', body: 'b' },
    { 'idempotency-key': key },
  )

// `ctx.db` (the harness pglite db) goes straight into pgliteRows; the relay needs the TxRunner view
// of the SAME db (the one unavoidable cross-driver cast, isolated to `relayDb` below).
const outboxRows = (db: ScenarioCtx['db']) =>
  pgliteRows<{ id: string; published_at: string | null }>(
    db,
    sql`SELECT id, published_at FROM outbox`,
  )

describe('content scenario: broker down (Commitment 17)', () => {
  let ctx: ScenarioCtx
  afterEach(async () => {
    await ctx.close()
  })

  it('createPost still returns 201 and retains the outbox row for redelivery when the broker is down', async () => {
    ctx = await setup()
    const created = await createPost(ctx.request)
    expect(created.status).toBe(201)

    const staged = await outboxRows(ctx.db)
    expect(staged.length).toBe(1)
    expect(staged[0]?.published_at).toBeNull()

    const relayDb = ctx.db as unknown as TxRunner
    // Drain against a DOWN broker: nothing publishes, the row stays pending — never lost.
    const down = brokerDouble('down')
    const downRelay = createRelay({ db: relayDb, publisher: down, clock: ctx.clock })
    expect(await downRelay.drainOnce()).toBe(0)
    expect(down.published).toEqual([])
    expect((await outboxRows(ctx.db))[0]?.published_at).toBeNull()

    // A healthy broker then drains the very same row — at-least-once delivery preserved.
    const up = brokerDouble('up')
    const upRelay = createRelay({ db: relayDb, publisher: up, clock: ctx.clock })
    expect(await upRelay.drainOnce()).toBe(1)
    expect(up.published).toHaveLength(1)
  })
})

describe('content scenario: DB failure surfaces as a typed problem (never a bare 500)', () => {
  let ctx: ScenarioCtx
  afterEach(async () => {
    await ctx.close()
  })

  // The outbox stage is a raw `execute` (not a drizzle insert) and the createPost transaction is
  // itself wrapped by withIdempotency, so a stable mid-transaction fault target is the posts insert
  // or the whole transaction; the post-write rollback invariant is pinned separately, robustly, in
  // the flags rollback scenario (failingDb → no partial state).
  it.each<{ fault: FailMatcher; label: string }>([
    { fault: { op: 'insert', table: 'posts' }, label: 'the posts insert' },
    { fault: { op: 'transaction' }, label: 'the whole createPost transaction' },
  ])('a DB failure on $label returns a retryable RFC 7807 problem, not a bare 500', async ({
    fault,
  }) => {
    ctx = await setup(fault)

    const res = await createPost(ctx.request)

    expect(res.status).toBe(500)
    const problem = expectRFC7807(res.json, { status: 500 })
    expect(problem.failure_domain).toBe('internal_error')
    expect(problem.retryable).toBe(true)
  })
})

// No afterEach here: runTwiceAndDiff builds + closes its own two worlds.
describe('content scenario: determinism', () => {
  it('the DB-failure scenario yields a structurally identical outcome on two seeded runs', async () => {
    const check = await runTwiceAndDiff(async () => {
      const s = await setup({ op: 'insert', table: 'posts' })
      return {
        act: async () => {
          const res = await createPost(s.request)
          return { status: res.status, problem: res.json }
        },
        close: s.close,
      }
    })

    expect(check.identical).toBe(true)
    expect(check.first.value?.status).toBe(500)
  })
})
