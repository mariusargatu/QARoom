import { FlagStateChangedEvent } from '@qaroom/contracts'
import type { Clock } from '@qaroom/determinism'
import { type EventHandler, runConsumer } from '@qaroom/messaging'
import type { DonationsDb } from './db/client'
import { setFlagEnabled } from './repository'

/** Durable consumer + dedup subscription name for the flag-state projection. */
export const FLAG_SUBSCRIPTION = 'donations.on-flag-state'

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

type RunConsumerOpts = Parameters<typeof runConsumer>[0]

/** Start the durable JetStream consumer that keeps the flag cache current. Returns a stop fn. */
export function startDonationsConsumer(
  js: RunConsumerOpts['js'],
  stream: string,
  db: DonationsDb,
  clock: Clock,
): Promise<() => Promise<void>> {
  return runConsumer({
    js,
    stream,
    durable: FLAG_SUBSCRIPTION,
    subscriptionName: FLAG_SUBSCRIPTION,
    db,
    clock,
    handler: flagStateChangedHandler(clock),
  })
}
