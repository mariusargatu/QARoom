import { FLAGS_FEED_SUBJECT, FlagStateChangedEvent } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { type EventHandler, ensureConsumer, type NatsHandle, runConsumer } from '@qaroom/messaging'
import type { DonationsDb } from './db/client'
import { setFlagEnabled } from './repository'

/**
 * Durable consumer + dedup subscription name for the flag-state projection. Hyphenated, not
 * dotted: JetStream rejects a durable name containing '.' (`InvalidNameError`).
 */
export const FLAG_SUBSCRIPTION = 'donations-on-flag-state'

/**
 * Project `flag.state.changed` events into the local `flag_cache` so donation gating reads a
 * cache instead of calling flags-service synchronously. Dedup + tenant scope are handled by
 * `processEvent`; this handler is the pure effect, unit-tested directly with no broker.
 */
export function flagStateChangedHandler(clock: Clock): EventHandler {
  return async (tx, payload) => {
    const evt = FlagStateChangedEvent.parse(payload)
    await setFlagEnabled(tx, evt.community_id, evt.flag_key, evt.enabled, clock.now())
  }
}

/**
 * Start the durable JetStream consumer that keeps the flag cache current. The consumer is
 * created (filtered to flag events only — donations publishes donation events to the same
 * stream, which this handler must not see) before `runConsumer` gets it. Returns a stop fn.
 *
 * Replay note: a freshly-created durable defaults to deliver-from-start, so on first creation it
 * replays the flag history to REBUILD the cache; thereafter the durable resumes from its acked
 * position across restarts. This is safe only because `flagStateChangedHandler` is an idempotent
 * upsert — a future non-idempotent consumer would need an explicit deliver policy and/or an
 * occurred_at guard.
 */
export async function startDonationsConsumer(
  handle: NatsHandle,
  stream: string,
  db: DonationsDb,
  clock: Clock,
): Promise<() => Promise<void>> {
  await ensureConsumer(handle, {
    stream,
    durable: FLAG_SUBSCRIPTION,
    filterSubjects: [FLAGS_FEED_SUBJECT],
  })
  return runConsumer({
    js: handle.js,
    stream,
    durable: FLAG_SUBSCRIPTION,
    subscriptionName: FLAG_SUBSCRIPTION,
    db,
    clock,
    handler: flagStateChangedHandler(clock),
  })
}
