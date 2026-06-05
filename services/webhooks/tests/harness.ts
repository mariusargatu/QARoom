import { EXAMPLE_COMMUNITY_ID, LamportGate, type WebhookEventType } from '@qaroom/contracts'
import { activeSpanSink } from '@qaroom/otel'
import type { SeedConfig } from '@qaroom/testing-utils/harness'
import { injectClient, nextIdempotencyKey, setupServiceTest } from '@qaroom/testing-utils/harness'
import { buildApp } from '../src/app'
import type { WebhooksDb } from '../src/db/client'
import { ensureSchema } from '../src/db/migrate'
import type { RepoDeps, WorkerDeps } from '../src/deps'
import {
  createSubscription,
  insertPendingDelivery,
  type WebhookSubscriptionWithSecretRecord,
} from '../src/repository'
import type { SendResult, WebhookSender, WebhookSendRequest } from '../src/sender'
import { createDeliveryWorker, type DeliveryWorker } from '../src/worker'

/** A WebhookSender double that records every request and replays a scripted outcome sequence. */
export interface RecordingSender extends WebhookSender {
  calls: WebhookSendRequest[]
}

/** Replays `outcomes` in order, clamping to the last entry once exhausted. */
export function scriptedSender(outcomes: SendResult[]): RecordingSender {
  const calls: WebhookSendRequest[] = []
  let i = 0
  return {
    calls,
    async send(req) {
      calls.push(req)
      const out = outcomes[Math.min(i, outcomes.length - 1)] ?? { kind: 'success', status: 200 }
      i += 1
      return out
    },
  }
}

/** Always returns 2xx — a scriptedSender that only ever yields success. */
export function okSender(): RecordingSender {
  return scriptedSender([{ kind: 'success', status: 200 }])
}

export async function setupWebhooksTest(opts: { seed?: SeedConfig } = {}) {
  const ctx = await setupServiceTest({
    applyMigrations: (db) => ensureSchema(db),
    createApp: (deps) =>
      buildApp({
        db: deps.db as unknown as WebhooksDb,
        clock: deps.clock,
        ids: deps.ids,
        randomness: deps.randomness,
      }),
    seed: opts.seed,
  })
  return { ...ctx, request: injectClient(ctx.app), db: ctx.db as unknown as WebhooksDb }
}

type Ctx = Awaited<ReturnType<typeof setupWebhooksTest>>

function repoDeps(ctx: Ctx): RepoDeps {
  return {
    clock: ctx.clock,
    ids: ctx.ids,
    randomness: ctx.randomness,
    lamport: new LamportGate(ctx.ids, activeSpanSink),
  }
}

/** Seed a subscription directly (bypassing the HTTP route). */
export function seedSubscription(
  ctx: Ctx,
  opts: { communityId?: string; url?: string; eventTypes?: WebhookEventType[] } = {},
): Promise<WebhookSubscriptionWithSecretRecord> {
  return createSubscription(ctx.db, repoDeps(ctx), {
    communityId: opts.communityId ?? SAMPLE.communityA,
    url: opts.url ?? 'https://hooks.example.com/qaroom',
    eventTypes: opts.eventTypes ?? ['post.created'],
  })
}

/** Enqueue a Pending delivery directly (bypassing the NATS fan-out). */
export function enqueueDelivery(
  ctx: Ctx,
  opts: {
    subscriptionId: string
    communityId?: string
    eventId?: string
    eventType?: WebhookEventType
  },
): Promise<void> {
  return insertPendingDelivery(ctx.db, {
    id: ctx.ids.next('whdel'),
    subscriptionId: opts.subscriptionId,
    communityId: opts.communityId ?? SAMPLE.communityA,
    eventId: opts.eventId ?? ctx.ids.next('evt'),
    eventType: opts.eventType ?? 'post.created',
    payload: {
      event_id: opts.eventId ?? 'evt_x',
      community_id: opts.communityId ?? SAMPLE.communityA,
    },
    now: ctx.clock.now(),
  })
}

/** Build a delivery worker over the test db with the given sender (and optional span sink). */
export function makeWorker(
  ctx: Ctx,
  sender: WebhookSender,
  opts: { deliverySink?: WorkerDeps['deliverySink']; randomness?: WorkerDeps['randomness'] } = {},
): DeliveryWorker {
  return createDeliveryWorker({
    db: ctx.db,
    clock: ctx.clock,
    ids: ctx.ids,
    randomness: opts.randomness ?? ctx.randomness,
    sender,
    deliverySink: opts.deliverySink,
  })
}

/** A Randomness double pinned near 1 so `nextBackoff` ≈ the ceiling (for cap-boundary assertions). */
export const nearOneRandomness = { next: () => 0.999_999, int: () => 255 }

/**
 * Drain the worker to quiescence: advance the FakeClock past any scheduled backoff, drain, repeat
 * until no row is due. Deterministic — no real sleeping. Returns total passes (a runaway guard).
 */
export async function drainToQuiescence(
  ctx: Ctx,
  worker: DeliveryWorker,
  maxPasses = 100,
): Promise<number> {
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    ctx.clock.advance(3_600_001) // > max_delay_ms, so any scheduled retry is now due
    const attempted = await worker.drainOnce()
    if (attempted === 0) return pass
  }
  throw new Error('worker did not reach quiescence')
}

export const SAMPLE = {
  communityA: EXAMPLE_COMMUNITY_ID,
  communityB: 'comm_01HZY0K7M3QF8VN2J5RX9TB4CE',
} as const

export const nextKey = () => nextIdempotencyKey('webhooks')
