import {
  type ApplyEventOptions,
  type ApplyEventResult,
  applyMachineEvent,
  type TransitionRecord,
  type TransitionSink,
} from './apply-event'
import {
  type WebhookDeliveryEvent,
  type WebhookDeliveryStateName,
  webhookDeliveryMachine,
} from './webhook-delivery.machine'

export type WebhookDeliveryTransitionRecord = TransitionRecord<
  WebhookDeliveryStateName,
  WebhookDeliveryEvent['type']
>
export type WebhookDeliveryTransitionSink = TransitionSink<
  WebhookDeliveryStateName,
  WebhookDeliveryEvent['type']
>
export type ApplyWebhookDeliveryOptions = ApplyEventOptions<
  WebhookDeliveryStateName,
  WebhookDeliveryEvent['type']
>
export type WebhookDeliveryApplyResult = ApplyEventResult<
  WebhookDeliveryStateName,
  WebhookDeliveryEvent['type']
>

/**
 * Apply a single delivery event — see {@link applyMachineEvent}. An illegal event leaves the
 * state unchanged (`changed: false`); the worker treats that as a programming error (it should
 * never drive an illegal edge), not a silent no-op.
 */
export function applyWebhookDeliveryEvent(
  currentState: WebhookDeliveryStateName,
  event: WebhookDeliveryEvent['type'],
  opts: ApplyWebhookDeliveryOptions,
): WebhookDeliveryApplyResult {
  return applyMachineEvent(webhookDeliveryMachine, currentState, event, opts)
}
