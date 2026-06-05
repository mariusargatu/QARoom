import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import { WebhookDeliveryStatus } from '../webhook'
import { isWebhookDeliveryTerminal, webhookDeliveryMachine } from './webhook-delivery.machine'

describe('webhook-delivery machine', () => {
  it('advances a delivery from Pending through Delivering to Delivered on a successful attempt', () => {
    const actor = createActor(webhookDeliveryMachine)
    actor.start()
    expect(actor.getSnapshot().value).toBe('Pending')
    actor.send({ type: 'AttemptStarted' })
    expect(actor.getSnapshot().value).toBe('Delivering')
    actor.send({ type: 'DeliverySucceeded' })
    expect(actor.getSnapshot().value).toBe('Delivered')
    actor.stop()
  })

  it('moves a delivery from Delivering to Retrying on a failed attempt, then back to Delivering', () => {
    const actor = createActor(webhookDeliveryMachine)
    actor.start()
    actor.send({ type: 'AttemptStarted' })
    actor.send({ type: 'DeliveryFailed' })
    expect(actor.getSnapshot().value).toBe('Retrying')
    actor.send({ type: 'AttemptStarted' })
    expect(actor.getSnapshot().value).toBe('Delivering')
    actor.stop()
  })

  it('moves a delivery from Delivering to DeadLettered when retries are exhausted', () => {
    const actor = createActor(webhookDeliveryMachine)
    actor.start()
    actor.send({ type: 'AttemptStarted' })
    actor.send({ type: 'RetriesExhausted' })
    expect(actor.getSnapshot().value).toBe('DeadLettered')
    actor.stop()
  })

  it('ignores an event that is illegal from the current state (no transition)', () => {
    const actor = createActor(webhookDeliveryMachine)
    actor.start()
    // DeliverySucceeded is only legal from Delivering; from Pending it is a no-op.
    actor.send({ type: 'DeliverySucceeded' })
    expect(actor.getSnapshot().value).toBe('Pending')
    actor.stop()
  })

  it('treats Delivered and DeadLettered as the terminal projection', () => {
    expect(isWebhookDeliveryTerminal('Delivered')).toBe(true)
    expect(isWebhookDeliveryTerminal('DeadLettered')).toBe(true)
    expect(isWebhookDeliveryTerminal('Pending')).toBe(false)
    expect(isWebhookDeliveryTerminal('Delivering')).toBe(false)
    expect(isWebhookDeliveryTerminal('Retrying')).toBe(false)
  })
})

// @xstate/graph hard-rejects invoke/after and any context explodes its BFS. This guard fails
// the moment someone adds an invocation or delayed transition to the delivery machine.
const stateConfigs = Object.entries(
  (webhookDeliveryMachine.config.states ?? {}) as Record<string, Record<string, unknown>>,
)

describe('webhook-delivery machine stays @xstate/graph-traversable', () => {
  it.each(stateConfigs)('state %s declares neither invoke nor after', (_name, config) => {
    expect('invoke' in config).toBe(false)
    expect('after' in config).toBe(false)
  })

  it('declares no machine-level context keys (context-free)', () => {
    expect(Object.keys(webhookDeliveryMachine.config.context ?? {})).toHaveLength(0)
  })
})

describe('machine states agree with the WebhookDeliveryStatus contract', () => {
  it('every machine state is a WebhookDeliveryStatus and vice versa', () => {
    const machineStates = Object.keys(webhookDeliveryMachine.config.states ?? {}).sort()
    expect(machineStates).toEqual([...WebhookDeliveryStatus.options].sort())
  })
})
