import { setup } from 'xstate'

/**
 * The webhook-delivery state machine (Milestone 11, ADR-0019). Each `webhook_deliveries` row's
 * status is the current state of this machine, advanced only through explicit events as the
 * delivery worker attempts the outbound POST:
 *
 *   Pending  --AttemptStarted--> Delivering
 *   Retrying --AttemptStarted--> Delivering
 *   Delivering --DeliverySucceeded--> Delivered      (terminal)
 *   Delivering --DeliveryFailed--> Retrying          (attempt budget remains)
 *   Delivering --RetriesExhausted--> DeadLettered    (terminal)
 *
 * DELIBERATELY invoke-free and context-free, exactly like `rollout.machine.ts`. The real I/O
 * (the HTTP POST, the backoff schedule, persisting the row) happens in the webhooks-service
 * worker, which drives this machine via `applyWebhookDeliveryEvent` (webhook-delivery.runner.ts)
 * and records each transition to a sink that becomes an `xstate.transition` OTel span — so MBT
 * (`@xstate/graph`) and Tracetest reverse-conformance (ADR-0012) operate on THIS machine,
 * unchanged. The worker — not the machine — chooses between `DeliveryFailed` and
 * `RetriesExhausted` (via `nextBackoff(...) === null`).
 *
 * `Delivered`/`DeadLettered` are terminal but NOT XState `final` states (the rollout precedent),
 * so a stored delivery can be re-hydrated from its state via `resolveState` without tripping
 * final-state semantics, and `@xstate/graph` traversal stays consistent. State names are
 * PascalCase nouns identical to `WebhookDeliveryStatus` (../webhook.ts); a test asserts they
 * agree so the API can never report an unreachable state.
 */

export type WebhookDeliveryStateName =
  | 'Pending'
  | 'Delivering'
  | 'Delivered'
  | 'Retrying'
  | 'DeadLettered'

export type WebhookDeliveryEvent =
  | { type: 'AttemptStarted' }
  | { type: 'DeliverySucceeded' }
  | { type: 'DeliveryFailed' }
  | { type: 'RetriesExhausted' }

/**
 * Context is the EMPTY object on purpose. Per-delivery data (attempt count, next-attempt time,
 * last status code) lives in the `webhook_deliveries` row and the runner's transition records,
 * NOT in machine context — the constraint that keeps `@xstate/graph` traversal finite.
 */
export type WebhookDeliveryContext = Record<string, never>

export const webhookDeliveryMachine = setup({
  types: {
    context: {} as WebhookDeliveryContext,
    events: {} as WebhookDeliveryEvent,
  },
}).createMachine({
  id: 'webhookDelivery',
  initial: 'Pending',
  context: {},
  states: {
    Pending: {
      on: { AttemptStarted: { target: 'Delivering' } },
    },
    Delivering: {
      on: {
        DeliverySucceeded: { target: 'Delivered' },
        DeliveryFailed: { target: 'Retrying' },
        RetriesExhausted: { target: 'DeadLettered' },
      },
    },
    Retrying: {
      on: { AttemptStarted: { target: 'Delivering' } },
    },
    Delivered: {
      // Terminal, but not an XState `final` state (rollout precedent).
    },
    DeadLettered: {
      // Terminal, but not an XState `final` state (rollout precedent).
    },
  },
})

export type WebhookDeliveryMachine = typeof webhookDeliveryMachine

/** The reached-a-terminal-state projection used by `/system/state` delivery counts. */
export function isWebhookDeliveryTerminal(state: WebhookDeliveryStateName): boolean {
  return state === 'Delivered' || state === 'DeadLettered'
}
