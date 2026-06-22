import { LamportGate } from '@qaroom/contracts'
import { type RepoTest, setupRepoTest } from '@qaroom/testing-utils/harness'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DonationsDb } from './db/client'
import { ensureSchema } from './db/migrate'
import type { RepoDeps } from './deps'
import type { ChargeRequest, PaymentClient } from './payment-client'
import { createDonation, DONATIONS_FLAG, listDonations, setFlagEnabled } from './repository'

const COMMUNITY_A = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD'
const COMMUNITY_B = 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE'
const DONOR = 'user_01HZY0K7M3QF8VN2J5RX9TB4CF'

/** A payment stub that records every charge request it receives. */
const recordingPayment = (): { client: PaymentClient; calls: ChargeRequest[] } => {
  const calls: ChargeRequest[] = []
  return {
    calls,
    client: {
      charge: async (req) => {
        calls.push(req)
        return { provider_ref: 'pay_rec', status: 'captured' }
      },
    },
  }
}

let ctx: RepoTest<DonationsDb>

const deps = (payment: PaymentClient): RepoDeps => ({
  clock: ctx.clock,
  ids: ctx.ids,
  lamport: new LamportGate(ctx.ids),
  payment,
})

const input = (overrides: Partial<Parameters<typeof createDonation>[2]> = {}) => ({
  communityId: COMMUNITY_A,
  donorId: DONOR,
  amountCents: 737,
  currency: 'EUR',
  idempotencyKey: 'idem-charge-1',
  ...overrides,
})

const enable = (comm: string) => setFlagEnabled(ctx.db, comm, DONATIONS_FLAG, true, ctx.clock.now())

beforeEach(async () => {
  ctx = await setupRepoTest<DonationsDb>({ applyMigrations: (db) => ensureSchema(db) })
})

afterEach(async () => {
  await ctx.close()
})

describe('repository/createDonation — charge-vs-record oracle', () => {
  it('passes the input-derived amount, currency, and idempotency key to the payment provider', async () => {
    await enable(COMMUNITY_A)
    const payment = recordingPayment()
    const res = await createDonation(ctx.db, deps(payment.client), input())

    expect(payment.calls.length).toBe(1)
    // The charge args must be derived from the request, not constants or a dropped field.
    expect(payment.calls[0]).toEqual({
      amount_cents: 737,
      currency: 'EUR',
      idempotency_key: 'idem-charge-1',
    })
    // And the recorded row must agree with what was charged: charge and record share the truth.
    expect(res).toMatchObject({
      ok: true,
      donation: { amount_cents: 737, currency: 'EUR' },
    })
  })
})

describe('repository/listDonations — per-item tenancy oracle', () => {
  it('returns only the requested community’s donations, asserting each item’s community_id', async () => {
    await enable(COMMUNITY_A)
    await enable(COMMUNITY_B)

    // Community A first, then community B with strictly newer timestamps: a count-neutral
    // "newest-N across all tenants" read would surface B's rows for an A query.
    await createDonation(
      ctx.db,
      deps(recordingPayment().client),
      input({ communityId: COMMUNITY_A, idempotencyKey: 'a1' }),
    )
    ctx.clock.advance(1000)
    await createDonation(
      ctx.db,
      deps(recordingPayment().client),
      input({ communityId: COMMUNITY_A, idempotencyKey: 'a2' }),
    )
    ctx.clock.advance(1000)
    await createDonation(
      ctx.db,
      deps(recordingPayment().client),
      input({ communityId: COMMUNITY_B, idempotencyKey: 'b1' }),
    )
    ctx.clock.advance(1000)
    await createDonation(
      ctx.db,
      deps(recordingPayment().client),
      input({ communityId: COMMUNITY_B, idempotencyKey: 'b2' }),
    )

    // Request A's two donations with an explicit limit equal to A's count, so a cross-tenant
    // newest-N leak stays count-neutral (still two rows) yet wrong on ownership.
    const list = await listDonations(ctx.db, COMMUNITY_A, 2)
    expect(list.length).toBe(2)
    for (const d of list) {
      expect(d.community_id).toBe(COMMUNITY_A)
    }
  })
})
