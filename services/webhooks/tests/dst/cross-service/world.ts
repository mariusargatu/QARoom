import { PGlite } from '@electric-sql/pglite'
import { buildApp as buildContentApp } from '@qaroom/content'
import type { ContentDb } from '@qaroom/content/db/client'
import { ensureSchema as ensureContentSchema } from '@qaroom/content/db/migrate'
import { LamportGate, POSTS_FEED_SUBJECT } from '@qaroom/contracts'
import { createRelay, type Relay, type TxRunner } from '@qaroom/messaging'
import { activeSpanSink } from '@qaroom/otel'
import { FakeClock, SeededIdGenerator, SeededRandomness } from '@qaroom/testing-utils/determinism'
import { injectClient, type RequestClient } from '@qaroom/testing-utils/harness'
import {
  type InMemoryBroker,
  type InMemoryBrokerFaults,
  inMemoryBroker,
} from '@qaroom/testing-utils/scenario'
import { drizzle } from 'drizzle-orm/pglite'
import { WEBHOOK_FANOUT_DURABLE, WEBHOOK_FEED_SUBJECTS } from '../../../src/consumer'
import type { WebhooksDb } from '../../../src/db/client'
import { ensureSchema as ensureWebhooksSchema } from '../../../src/db/migrate'
import { createSubscription } from '../../../src/repository'
import { createDeliveryWorker, type DeliveryWorker } from '../../../src/worker'
import { SimReceiver } from '../sim-receiver'
import { type Coverage, emptyCoverage, type SimSubscription, seedFor } from '../types'
import { BASE_INSTANT, RecordingDeliverySink } from '../world'
import { type ModeratorStub, moderatorStub } from './moderator-stub'
import { type CrossCoverage, emptyCrossCoverage } from './types'
import {
  type ComposedConfig,
  defaultConfig,
  generateSubscriptionSpecs,
  generateWorkload,
  type WorkloadAction,
} from './workload'

/**
 * One TWO-SERVICE simulation WORLD (T22, ADR-0029): content (producer) and webhooks (consumer)
 * composed in ONE process over a single in-memory broker, TWO PGlite databases, and ONE shared
 * virtual clock. Both services run their REAL composition roots — content's Fastify app and outbox
 * relay, webhooks' fan-out + delivery worker — wired to the same seams they already inject for
 * determinism (Commitment 6); only the clock (virtual), the per-service randomness/ids (seeded), the
 * bus (in-memory), and the receiver network (simulated) are substituted. The moderator joins as a
 * seeded sim consumer on the same bus (its model call stubbed — the DST kernel boundary at the LLM
 * edge). Everything is a pure function of one `seed`, so two worlds from the same seed are
 * indistinguishable — the precondition for the byte-identical composed meta-test.
 */

/** The moderator stub's durable name (it consumes `post.created` like any other bus subscriber). */
export const MODERATOR_DURABLE = 'moderator-decisions'

export interface ComposedWorld {
  seed: number
  /** The single virtual clock both services share — one global timeline. */
  clock: FakeClock
  /** The in-memory bus both services meet on. */
  broker: InMemoryBroker
  // --- content (producer) ---
  contentDb: ContentDb
  contentRequest: RequestClient
  /** content's real transactional-outbox relay, draining its outbox onto the broker. */
  relay: Relay
  // --- webhooks (consumer) ---
  webhooksDb: WebhooksDb
  /** webhooks' IdGenerator (independent stream from content's) — used by the fan-out effect. */
  webhooksIds: SeededIdGenerator
  worker: DeliveryWorker
  receiver: SimReceiver
  sink: RecordingDeliverySink
  // --- moderator (seeded sim consumer at the kernel boundary) ---
  moderator: ModeratorStub
  // --- world shape ---
  subscriptions: SimSubscription[]
  secretBySubId: Map<string, string>
  workload: WorkloadAction[]
  receiverCoverage: Coverage
  cross: CrossCoverage
  /** One-shot consumer-side redelivery (un-ack the first fan-out message once) — at-least-once. */
  redeliver: { budget: number; done: Set<string> }
  fanoutDurable: string
  moderatorDurable: string
  close(): Promise<void>
}

export interface ComposedWorldOptions {
  config?: ComposedConfig
  /** Broker faults — the planted cross-service bug arms `dropPublishOnce` here. */
  brokerFaults?: InMemoryBrokerFaults
}

/** Build a fresh composed world for `seed`. The caller drives it with `runComposed` (drive.ts). */
export async function setupComposedWorld(
  seed: number,
  opts: ComposedWorldOptions = {},
): Promise<ComposedWorld> {
  const config = opts.config ?? defaultConfig(seed)
  const clock = new FakeClock(BASE_INSTANT)
  const broker = inMemoryBroker(opts.brokerFaults)
  const receiverCoverage = emptyCoverage()

  // --- content (producer): real app + real outbox relay over its own PGlite + id/randomness stream ---
  const contentPglite = new PGlite()
  const rawContentDb = drizzle(contentPglite)
  const contentDb = rawContentDb as unknown as ContentDb
  await ensureContentSchema(rawContentDb)
  const contentIds = new SeededIdGenerator(seedFor(seed, 1))
  const contentRandomness = new SeededRandomness(seedFor(seed, 2))
  const contentApp = buildContentApp({
    db: contentDb,
    clock,
    ids: contentIds,
    randomness: contentRandomness,
  })
  const relay = createRelay({
    db: rawContentDb as unknown as TxRunner,
    publisher: broker.publisher,
    clock,
  })

  // --- webhooks (consumer): real fan-out + delivery worker over its own PGlite + id/randomness stream ---
  const webhooksPglite = new PGlite()
  const webhooksDb = drizzle(webhooksPglite) as unknown as WebhooksDb
  await ensureWebhooksSchema(webhooksDb)
  const webhooksIds = new SeededIdGenerator(seedFor(seed, 3))
  const webhooksRandomness = new SeededRandomness(seedFor(seed, 4))
  const receiver = new SimReceiver(seedFor(seed, 6), receiverCoverage)
  const sink = new RecordingDeliverySink()
  const worker = createDeliveryWorker({
    db: webhooksDb,
    clock,
    ids: webhooksIds,
    randomness: webhooksRandomness,
    sender: receiver,
    deliverySink: sink,
  })

  // Register the external subscriptions on webhooks (bypassing the gateway-proxied HTTP route).
  const gen = new SeededRandomness(seedFor(seed, 5))
  const repoDeps = {
    clock,
    ids: webhooksIds,
    randomness: webhooksRandomness,
    lamport: new LamportGate(webhooksIds, activeSpanSink),
  }
  const subscriptions: SimSubscription[] = []
  const secretBySubId = new Map<string, string>()
  for (const spec of generateSubscriptionSpecs(gen, config)) {
    const record = await createSubscription(webhooksDb, repoDeps, {
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

  // Both consumers bind their durables on the broker (each gets its own cursor).
  broker.registerDurable({ durable: WEBHOOK_FANOUT_DURABLE, filterSubjects: WEBHOOK_FEED_SUBJECTS })
  broker.registerDurable({ durable: MODERATOR_DURABLE, filterSubjects: [POSTS_FEED_SUBJECT] })

  return {
    seed,
    clock,
    broker,
    contentDb,
    contentRequest: injectClient(contentApp),
    relay,
    webhooksDb,
    webhooksIds,
    worker,
    receiver,
    sink,
    moderator: moderatorStub(seedFor(seed, 7)),
    subscriptions,
    secretBySubId,
    workload: generateWorkload(gen, config),
    receiverCoverage,
    cross: emptyCrossCoverage(),
    redeliver: { budget: 1, done: new Set() },
    fanoutDurable: WEBHOOK_FANOUT_DURABLE,
    moderatorDurable: MODERATOR_DURABLE,
    async close() {
      await contentApp.close()
      await contentPglite.close()
      await webhooksPglite.close()
    },
  }
}
