import type { JsMsg } from '@nats-io/jetstream'
import { describe, expect, it } from 'vitest'
import { deliveryBudgetSettlement, settleByDeliveryBudget } from './settle'

const opts = { max: 5, poisonReason: 'exceeded delivery budget' }

/** A JsMsg double recording the broker settle call the consumer would issue. */
function fakeMsg(deliveryCount: number) {
  const calls = { term: [] as string[], naks: 0 }
  const message = {
    info: { deliveryCount },
    term: (reason: string) => {
      calls.term.push(reason)
    },
    nak: () => {
      calls.naks += 1
    },
  } as unknown as JsMsg
  return { message, calls }
}

describe('deliveryBudgetSettlement', () => {
  it('naks while under the delivery budget', () => {
    expect(deliveryBudgetSettlement(1, opts)).toEqual({ action: 'nak' })
    expect(deliveryBudgetSettlement(4, opts)).toEqual({ action: 'nak' })
  })

  it('terms with the poison reason at the budget', () => {
    expect(deliveryBudgetSettlement(5, opts)).toEqual({
      action: 'term',
      reason: 'exceeded delivery budget',
    })
  })

  it('terms once the budget is exceeded', () => {
    expect(deliveryBudgetSettlement(9, opts)).toEqual({
      action: 'term',
      reason: 'exceeded delivery budget',
    })
  })
})

describe('settleByDeliveryBudget applies the decision to a JetStream message', () => {
  it('naks a message still under the delivery budget', () => {
    const { message, calls } = fakeMsg(2)
    settleByDeliveryBudget(message, opts)
    expect(calls.naks).toBe(1)
    expect(calls.term).toEqual([])
  })

  it('terms a poison message at the delivery budget with the reason', () => {
    const { message, calls } = fakeMsg(5)
    settleByDeliveryBudget(message, opts)
    expect(calls.naks).toBe(0)
    expect(calls.term).toEqual(['exceeded delivery budget'])
  })
})
