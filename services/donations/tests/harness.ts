import { EXAMPLE_COMMUNITY_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import { injectClient, nextIdempotencyKey, setupServiceTest } from '@qaroom/testing-utils/harness'
import { buildApp } from '../src/app'
import type { DonationsDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'
import type { ChargeRequest, PaymentClient } from '../src/payment-client'
import { DONATIONS_FLAG, setFlagEnabled } from '../src/repository'

/** Payment-provider doubles for tests (the production client hits the Microcks mock). */
const alwaysCaptures = (): PaymentClient => ({
  charge: async () => ({ provider_ref: 'pay_test', status: 'captured' }),
})
export const alwaysDeclines = (): PaymentClient => ({
  charge: async () => ({ provider_ref: 'pay_test', status: 'declined' }),
})
export const alwaysErrors = (): PaymentClient => ({
  charge: async () => {
    throw new Error('payment provider unreachable')
  },
})

/**
 * A payment double that records every charge it receives, so an HTTP-level test can assert the
 * provider was hit exactly once across a retry. The provider call is the seam a double-charge bug
 * would breach; counting `calls` makes "charged once" observable from outside the repository.
 */
export const recordingPayment = (): { client: PaymentClient; calls: ChargeRequest[] } => {
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

export async function setupDonationsTest(
  opts: { seed?: SeedConfig; payment?: PaymentClient } = {},
) {
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: deps.db as unknown as DonationsDb,
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
        payment: opts.payment ?? alwaysCaptures(),
      }),
    seed: opts.seed,
  })
  return { ...ctx, request: injectClient(ctx.app) }
}

/** Enable the donations flag for a community by writing the gating cache directly. */
export async function enableDonations(
  ctx: Awaited<ReturnType<typeof setupDonationsTest>>,
  communityId: string,
): Promise<void> {
  await setFlagEnabled(ctx.db, communityId, DONATIONS_FLAG, true, ctx.clock.now())
}

export const SAMPLE = {
  communityA: EXAMPLE_COMMUNITY_ID,
  communityB: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
  user: EXAMPLE_USER_ID,
} as const

export const nextKey = () => nextIdempotencyKey('donations')
