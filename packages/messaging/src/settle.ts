import type { JsMsg } from '@nats-io/jetstream'

/**
 * How a failed message is settled back to the broker: redeliver (`nak`) or poison-quarantine
 * (`term`). The webhooks fan-out and the donations consumer reached the SAME decision
 * independently (donations' comment literally read "Mirrors the webhooks fan-out settle policy"),
 * so the policy now has one tested home instead of two copies that could drift.
 */
export type Settlement =
  | { readonly action: 'nak' }
  | { readonly action: 'term'; readonly reason: string }

/**
 * Pure settle decision: once a message has been delivered `max` times it is poison — `term` it
 * with a reason; otherwise `nak` for redelivery. No I/O, so it is unit-testable without a broker.
 */
export function deliveryBudgetSettlement(
  deliveryCount: number,
  opts: { max: number; poisonReason: string },
): Settlement {
  return deliveryCount >= opts.max
    ? { action: 'term', reason: opts.poisonReason }
    : { action: 'nak' }
}

/**
 * What a poison sink is told. Everything needed to find and replay the lost event is extracted
 * HERE rather than left to each caller, so five consumers cannot record five different subsets.
 */
export interface PoisonedMessage {
  readonly deliveryCount: number
  readonly reason: string
  readonly subject: string
  /** The `Nats-Msg-Id` header, which is the event's own `evt_<ulid>`; '' when absent. */
  readonly eventId: string
  /** The decoded body, or the raw string when it is not JSON — never dropped. */
  readonly payload: unknown
}

/** Pull the replay-relevant fields off a JsMsg without letting a malformed body throw. */
function describe_(message: JsMsg, reason: string): PoisonedMessage {
  let payload: unknown
  try {
    payload = message.json<unknown>()
  } catch {
    payload = { unparseable: message.string?.() ?? null }
  }
  return {
    deliveryCount: message.info.deliveryCount,
    reason,
    subject: message.subject,
    eventId: message.headers?.get('Nats-Msg-Id') ?? '',
    payload,
  }
}

/** What actually happened, so a caller can log or assert on it. */
export interface SettleOutcome {
  readonly terminated: boolean
  /** False when the sink threw: the message is still terminated, but the record did NOT land. */
  readonly recorded: boolean
}

/**
 * Apply {@link deliveryBudgetSettlement} to a JetStream message.
 *
 * `onPoison` is REQUIRED. `term()` tells JetStream to stop redelivering for good, and there is no
 * dead-letter stream, no `max_deliver`, and no advisory subscriber behind it — so before this the
 * message simply vanished, in all five consumers, under a "never lost" claim. Making the sink
 * mandatory means a silent termination cannot be expressed at all.
 *
 * The sink runs BEFORE `term()`, so the durable record exists before the broker is told to give
 * up. If the sink itself fails the message is STILL terminated (stranding it in redelivery forever
 * is not an improvement) but the returned outcome says `recorded: false`, so the caller can shout
 * rather than assume the record landed.
 */
export async function settleByDeliveryBudget(
  message: JsMsg,
  opts: {
    max: number
    poisonReason: string
    onPoison: (poisoned: PoisonedMessage) => Promise<void>
  },
): Promise<SettleOutcome> {
  const settlement = deliveryBudgetSettlement(message.info.deliveryCount, opts)
  if (settlement.action !== 'term') {
    message.nak()
    return { terminated: false, recorded: false }
  }
  let recorded = true
  try {
    await opts.onPoison(describe_(message, settlement.reason))
  } catch {
    recorded = false
  }
  message.term(settlement.reason)
  return { terminated: true, recorded }
}
