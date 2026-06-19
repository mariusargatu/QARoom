import { test } from '@fast-check/vitest'
import { backoffCeilingMs, nextBackoff, WEBHOOK_RETRY_POLICY } from '@qaroom/contracts'
import { rowsOf } from '@qaroom/messaging'
import { SeededRandomness } from '@qaroom/testing-utils/determinism'
import { sql } from 'drizzle-orm'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  enqueueDelivery,
  makeWorker,
  nearOneRandomness,
  scriptedSender,
  seedSubscription,
  setupWebhooksTest,
} from '../tests/harness'

/**
 * The retry-contract property (the milestone headline). The deterministic backoff schedule is a
 * pure function of (attempt, seed): exponential, capped, bounded in attempts, seed-determined.
 */
describe('webhook retry contract', () => {
  test.prop([
    fc.integer({ min: 1, max: WEBHOOK_RETRY_POLICY.max_attempts - 1 }),
    fc.integer({ min: 1, max: 1_000_000 }),
  ])(
    'every scheduled delay sits in [0, ceiling] and the ceiling never exceeds max_delay_ms',
    (attempt, seed) => {
      const delay = nextBackoff(attempt, new SeededRandomness(seed))
      expect(delay).not.toBeNull()
      const ceiling = backoffCeilingMs(attempt)
      expect(delay as number).toBeGreaterThanOrEqual(0)
      expect(delay as number).toBeLessThanOrEqual(ceiling)
      expect(ceiling).toBeLessThanOrEqual(WEBHOOK_RETRY_POLICY.max_delay_ms)
    },
  )

  test.prop([fc.integer({ min: 1, max: WEBHOOK_RETRY_POLICY.max_attempts - 2 })])(
    'the ceiling follows the capped-exponential law (catches a linear schedule)',
    (attempt) => {
      const a = backoffCeilingMs(attempt)
      const b = backoffCeilingMs(attempt + 1)
      // The exact law: next ceiling = min(prev * multiplier, cap). A linear (prev + base) or
      // uncapped schedule violates this at some attempt.
      expect(b).toBe(Math.min(a * WEBHOOK_RETRY_POLICY.multiplier, WEBHOOK_RETRY_POLICY.max_delay_ms))
    },
  )

  test.prop([fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 1000 })])(
    'returns null exactly when the attempt budget is exhausted',
    (attempt, seed) => {
      const result = nextBackoff(attempt, new SeededRandomness(seed))
      // null exactly when (and only when) the attempt budget is exhausted.
      expect(result === null).toBe(attempt >= WEBHOOK_RETRY_POLICY.max_attempts)
    },
  )

  test.prop([fc.integer({ min: 1, max: 1_000_000 })])(
    'is fully determined by the seed (same seed → same schedule)',
    (seed) => {
      const a = Array.from({ length: 7 }, (_, i) => nextBackoff(i + 1, new SeededRandomness(seed)))
      const b = Array.from({ length: 7 }, (_, i) => nextBackoff(i + 1, new SeededRandomness(seed)))
      expect(a).toEqual(b)
    },
  )
})

// Deliberate-bug demo: CHAOS_WEBHOOK_NO_CAP drops the max_delay_ms ceiling in the worker. With a
// near-1 jitter, the scheduled delay at a high attempt then exceeds the cap; the correct worker
// never schedules a delay above max_delay_ms.
describe('CHAOS_WEBHOOK_NO_CAP deliberate-bug demo', () => {
  afterEach(() => {
    delete process.env.CHAOS_WEBHOOK_NO_CAP
  })

  // Drive a single delivery through six failed attempts (Retrying@6) and return the scheduled
  // delay for that retry (next_attempt_at − updated_at). With near-1 jitter the delay ≈ the ceiling.
  async function delayAtAttempt6(): Promise<number> {
    const ctx = await setupWebhooksTest()
    const sub = await seedSubscription(ctx)
    await enqueueDelivery(ctx, { subscriptionId: sub.id })
    const worker = makeWorker(ctx, scriptedSender([{ kind: 'http_error', status: 500 }]), {
      randomness: nearOneRandomness,
    })
    // Six failed attempts → the delivery is Retrying at attempt 6.
    for (let i = 0; i < 6; i += 1) {
      ctx.clock.advance(3_600_001)
      await worker.drainOnce()
    }
    const rows = rowsOf<{ status: string; next_attempt_at: string; updated_at: string }>(
      await ctx.db.execute(
        sql`SELECT status, next_attempt_at, updated_at FROM webhook_deliveries LIMIT 1`,
      ),
    )
    await ctx.close()
    const row = rows[0]
    expect(row?.status).toBe('Retrying')
    return (
      new Date(row?.next_attempt_at ?? '').getTime() - new Date(row?.updated_at ?? '').getTime()
    )
  }

  it('the correct worker never schedules a delay above max_delay_ms', async () => {
    expect(await delayAtAttempt6()).toBeLessThanOrEqual(WEBHOOK_RETRY_POLICY.max_delay_ms)
  })

  it('the bugged (uncapped) worker schedules a delay above max_delay_ms', async () => {
    process.env.CHAOS_WEBHOOK_NO_CAP = '1'
    expect(await delayAtAttempt6()).toBeGreaterThan(WEBHOOK_RETRY_POLICY.max_delay_ms)
  })
})
