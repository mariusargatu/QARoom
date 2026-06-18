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
 * Apply {@link deliveryBudgetSettlement} to a JetStream message. The consumer's failure callback
 * collapses to one line: `settle: (m) => settleByDeliveryBudget(m, { max, poisonReason })`.
 */
export function settleByDeliveryBudget(
  message: JsMsg,
  opts: { max: number; poisonReason: string },
): void {
  const settlement = deliveryBudgetSettlement(message.info.deliveryCount, opts)
  if (settlement.action === 'term') message.term(settlement.reason)
  else message.nak()
}
