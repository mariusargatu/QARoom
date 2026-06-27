import type {
  WebhookDeliveryTransitionRecord,
  WebhookDeliveryTransitionSink,
} from '@qaroom/contracts'
import { SeededRandomness } from '@qaroom/testing-utils/determinism'
import type { WebhooksDb } from '../../src/db/client'
import { SAMPLE, seedSubscription, setupWebhooksTest } from '../harness'
import {
  applyEventFaults,
  generateEvents,
  generateSubscriptionSpecs,
  type SimEvent,
} from './event-bus'
import { SimReceiver } from './sim-receiver'
import {
  type Coverage,
  emptyCoverage,
  type SimConfig,
  type SimSubscription,
  seedFor,
} from './types'

/**
 * One in-process simulation WORLD (DST components 1–4): a single process holding a fresh PGlite, the
 * seeded determinism trio, a set of subscriptions with seeded receiver profiles, an event queue, and
 * a recording transition sink. Everything is a pure function of one `seed`, so two worlds built from
 * the same seed are indistinguishable — the precondition for the byte-identical meta-test.
 *
 * The world is the production app's real consumer + worker wiring; only the clock (virtual), the
 * randomness (seeded), and the receiver/network (simulated) are substituted — the seams the service
 * already injects for determinism (Commitment 6).
 */

/** The fixed instant every virtual clock starts from. */
export const BASE_INSTANT = '2026-01-01T00:00:00.000Z'

/** A delivery-transition sink that just records every `xstate.transition` the worker drives. */
export class RecordingDeliverySink implements WebhookDeliveryTransitionSink {
  readonly records: WebhookDeliveryTransitionRecord[] = []
  record(transition: WebhookDeliveryTransitionRecord): void {
    this.records.push(transition)
  }
}

export interface SimWorld {
  seed: number
  db: WebhooksDb
  clock: Awaited<ReturnType<typeof setupWebhooksTest>>['clock']
  ids: Awaited<ReturnType<typeof setupWebhooksTest>>['ids']
  randomness: Awaited<ReturnType<typeof setupWebhooksTest>>['randomness']
  receiver: SimReceiver
  sink: RecordingDeliverySink
  subscriptions: SimSubscription[]
  secretBySubId: Map<string, string>
  coverage: Coverage
  /** The faulted feed order — duplicates, redeliveries, and a seeded shuffle already applied. */
  queue: SimEvent[]
  close(): Promise<void>
}

/** Derive a world's size from its seed: a few subscriptions, a handful of events. */
export function defaultConfig(seed: number): SimConfig {
  return {
    seed,
    communities: [SAMPLE.communityA, SAMPLE.communityB],
    subscriptionCount: 3 + (seed % 2), // 3..4
    eventCount: 4 + (seed % 3), // 4..6
  }
}

/** Build a fresh world for `seed`. The caller drives it with `runSimulation` (drive.ts). */
export async function setupSimWorld(seed: number, config = defaultConfig(seed)): Promise<SimWorld> {
  const ctx = await setupWebhooksTest({
    seed: { ids: seed, randomness: seedFor(seed, 1), time: BASE_INSTANT },
  })
  const coverage = emptyCoverage()
  const gen = new SeededRandomness(seedFor(seed, 2))
  const receiver = new SimReceiver(seedFor(seed, 3), coverage)

  const specs = generateSubscriptionSpecs(gen, config)
  const subscriptions: SimSubscription[] = []
  const secretBySubId = new Map<string, string>()
  for (const spec of specs) {
    const record = await seedSubscription(ctx, {
      communityId: spec.communityId,
      url: spec.url,
      eventTypes: spec.eventTypes,
    })
    receiver.registerEndpoint(spec.url, spec.profile)
    subscriptions.push({
      id: record.id,
      url: spec.url,
      secret: record.secret,
      communityId: spec.communityId,
      profile: spec.profile,
    })
    secretBySubId.set(record.id, record.secret)
  }

  const events = generateEvents(gen, ctx.ids, config)
  const queue = applyEventFaults(gen, events, coverage)

  return {
    seed,
    db: ctx.db,
    clock: ctx.clock,
    ids: ctx.ids,
    randomness: ctx.randomness,
    receiver,
    sink: new RecordingDeliverySink(),
    subscriptions,
    secretBySubId,
    coverage,
    queue,
    close: ctx.close,
  }
}
