import {
  DONATION_STATE_CHANGED_EVENT,
  donationStateChanged,
  LamportGate,
} from '@qaroom/contracts'
import { pgliteRows, setupRepoTest, type RepoTest } from '@qaroom/testing-utils/harness'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DonationsDb } from './db/client'
import { ensureSchema } from './db/migrate'
import type { RepoDeps } from './deps'
import type { PaymentClient } from './payment-client'
import {
  countDonations,
  createDonation,
  DONATIONS_FLAG,
  getDonation,
  isDonationsEnabled,
  listDonations,
  setFlagEnabled,
} from './repository'

const COMMUNITY = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const DONOR = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'

const captures: PaymentClient = { charge: async () => ({ provider_ref: 'pay_1', status: 'captured' }) }
const declines: PaymentClient = { charge: async () => ({ provider_ref: 'pay_2', status: 'declined' }) }
const errors: PaymentClient = {
  charge: async () => {
    throw new Error('provider down')
  },
}

interface OutboxRow {
  subject: string
  event_name: string
  payload: Record<string, unknown>
}

let ctx: RepoTest<DonationsDb>

const deps = (payment: PaymentClient): RepoDeps => ({
  clock: ctx.clock,
  ids: ctx.ids,
  lamport: new LamportGate(ctx.ids),
  payment,
})

const input = (idempotencyKey = 'idem-1') => ({
  communityId: COMMUNITY,
  donorId: DONOR,
  amountCents: 500,
  currency: 'USD',
  idempotencyKey,
})

const enable = () => setFlagEnabled(ctx.db, COMMUNITY, DONATIONS_FLAG, true, ctx.clock.now())

const outboxRows = () =>
  pgliteRows<OutboxRow>(ctx.db, sql`SELECT subject, event_name, payload FROM outbox`)

beforeEach(async () => {
  ctx = await setupRepoTest<DonationsDb>({ applyMigrations: (db) => ensureSchema(db) })
})

afterEach(async () => {
  await ctx.close()
})

describe('repository/createDonation', () => {
  it('is gated when the donations flag is not enabled (no charge, no row)', async () => {
    const res = await createDonation(ctx.db, deps(captures), input())
    expect(res).toEqual({ ok: false, reason: 'gated' })
    expect(await countDonations(ctx.db)).toBe(0)
  })

  it('records a Captured donation and stages a DonationStateChanged outbox event when the provider captures', async () => {
    await enable()
    const res = await createDonation(ctx.db, deps(captures), input())
    expect(res).toMatchObject({ ok: true, donation: { status: 'Captured', community_id: COMMUNITY } })
    const rows = await outboxRows()
    expect(rows.length).toBe(1)
    expect(rows[0]?.subject).toBe(donationStateChanged(COMMUNITY))
    expect(rows[0]?.event_name).toBe(DONATION_STATE_CHANGED_EVENT)
    expect(rows[0]?.payload.status).toBe('Captured')
  })

  it('records a Failed donation on a provider decline — a business outcome, not an error', async () => {
    await enable()
    const res = await createDonation(ctx.db, deps(declines), input())
    expect(res).toMatchObject({ ok: true, donation: { status: 'Failed' } })
    expect(await countDonations(ctx.db)).toBe(1)
  })

  it('returns payment_unavailable and writes nothing when the provider throws', async () => {
    await enable()
    const res = await createDonation(ctx.db, deps(errors), input())
    expect(res).toEqual({ ok: false, reason: 'payment_unavailable' })
    expect(await countDonations(ctx.db)).toBe(0)
    expect((await outboxRows()).length).toBe(0)
  })
})

describe('repository/flag-cache + reads', () => {
  it('isDonationsEnabled is false when absent and true after the flag is cached enabled', async () => {
    expect(await isDonationsEnabled(ctx.db, COMMUNITY)).toBe(false)
    await enable()
    expect(await isDonationsEnabled(ctx.db, COMMUNITY)).toBe(true)
  })

  it('getDonation returns null for an unknown id', async () => {
    expect(await getDonation(ctx.db, 'dntn_01HZY0K7M3QF8VN2J5RX9TB4ZZ')).toBeNull()
  })

  it('listDonations returns a community newest-first and honors a custom limit', async () => {
    await enable()
    for (const key of ['a', 'b', 'c']) {
      await createDonation(ctx.db, deps(captures), input(key))
      ctx.clock.advance(1000)
    }
    const all = await listDonations(ctx.db, COMMUNITY)
    expect(all.length).toBe(3)
    const times = all.map((d) => d.created_at)
    expect(times).toEqual([...times].sort().reverse()) // ISO strings sort chronologically: newest-first
    const capped = await listDonations(ctx.db, COMMUNITY, 2)
    expect(capped.length).toBe(2)
  })
})
