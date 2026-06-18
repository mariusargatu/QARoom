import { connectNats, connectServiceDb, QAROOM_STREAM } from '@qaroom/messaging'
import { xstateTransitionSink } from '@qaroom/otel'
import { intFromEnv, pgPoolMax, resolveBootDeps, runServer } from '@qaroom/service-kit'
import { buildApp } from './app'
import { startWebhookFanout } from './consumer'
import { ensureSchema } from './db/migrate'
import { schema } from './db/schema'
import { createHttpWebhookSender } from './sender'
import { createDeliveryWorker } from './worker'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://qaroom:qaroom@localhost:5436/qaroom_webhooks'
const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222'
const port = intFromEnv('PORT', 8087)
const deliveryTimeoutMs = intFromEnv('WEBHOOKS_DELIVERY_TIMEOUT_MS', 5000)
const WORKER_INTERVAL_MS = 1000

// Snapshot-replay boot (Commitment 8): when replaying, the clock is pinned and the live-only wiring
// (NATS fan-out consumer + delivery worker + outbound sender) is skipped; captured state arrives via POST.
runServer(
  async () => {
    const { deps, replaying } = resolveBootDeps()
    const { db, snapshotStore } = connectServiceDb({ connectionString, schema, max: pgPoolMax() })
    await ensureSchema(db)

    if (!replaying) {
      // Fail-soft on the broker: the CRUD HTTP surface must boot even if NATS is briefly
      // unreachable (k8s will restart toward readiness; the trust-boundary fuzz lane needs only
      // Postgres). Delivery is degraded — not silently: the fault is written to stderr.
      try {
        const nats = await connectNats(natsUrl)
        // Fan each of the five domain events into the delivery ledger.
        await startWebhookFanout(nats, QAROOM_STREAM, db, { ids: deps.ids, clock: deps.clock })
        // Drain due deliveries, signing + POSTing each, with the deterministic retry contract.
        createDeliveryWorker({
          db,
          clock: deps.clock,
          ids: deps.ids,
          randomness: deps.randomness,
          sender: createHttpWebhookSender(deliveryTimeoutMs),
          deliverySink: xstateTransitionSink('webhook-delivery'),
        }).start(WORKER_INTERVAL_MS)
      } catch (err) {
        process.stderr.write(
          `webhooks: NATS unavailable at boot (${String(err)}); delivery engine not started\n`,
        )
      }
    }

    return buildApp({ db, snapshotStore, ...deps })
  },
  { port, name: 'webhooks-service' },
)
