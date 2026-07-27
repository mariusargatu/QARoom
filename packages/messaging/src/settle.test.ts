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
  // A no-op sink: these two cover the nak/term DECISION. That termination also records the
  // message is covered below, where the sink is the thing under test.
  const noopPoison = { onPoison: async () => {} }

  it('naks a message still under the delivery budget', async () => {
    const { message, calls } = fakeMsg(2)
    await settleByDeliveryBudget(message, { ...opts, ...noopPoison })
    expect(calls.naks).toBe(1)
    expect(calls.term).toEqual([])
  })

  it('terms a poison message at the delivery budget with the reason', async () => {
    const { message, calls } = fakeMsg(5)
    await settleByDeliveryBudget(message, { ...opts, ...noopPoison })
    expect(calls.naks).toBe(0)
    expect(calls.term).toEqual(['exceeded delivery budget'])
  })
})

/**
 * The loss path. Before this, `term()` was called with nothing recording the message, and the two
 * tests above asserted only that `term` was CALLED — which is exactly the shape of a test that
 * passes while the event disappears. `onPoison` is REQUIRED, so a caller cannot express a silent
 * termination any more, and it runs BEFORE `term()` so the record is durable before the broker is
 * told to stop redelivering.
 */
describe('settleByDeliveryBudget cannot terminate a message silently', () => {
  const opts = { max: 5, poisonReason: 'poison: exhausted delivery budget' }

  it('records the poisoned message before calling term', async () => {
    const order: string[] = []
    const message = {
      info: { deliveryCount: 5 },
      term: (r?: string) => order.push(`term:${r}`),
      nak: () => order.push('nak'),
    } as unknown as Parameters<typeof settleByDeliveryBudget>[0]
    await settleByDeliveryBudget(message, {
      ...opts,
      onPoison: async () => {
        order.push('recorded')
      },
    })
    expect(order).toEqual(['recorded', `term:${opts.poisonReason}`])
  })

  it('passes the delivery count and reason to the sink so the record is actionable', async () => {
    const seen: Array<{ deliveryCount: number; reason: string }> = []
    const message = {
      info: { deliveryCount: 7 },
      term: () => {},
      nak: () => {},
    } as unknown as Parameters<typeof settleByDeliveryBudget>[0]
    await settleByDeliveryBudget(message, {
      ...opts,
      onPoison: async (info) => {
        seen.push({ deliveryCount: info.deliveryCount, reason: info.reason })
      },
    })
    expect(seen).toEqual([{ deliveryCount: 7, reason: opts.poisonReason }])
  })

  it('does not call the sink when the message is merely naked for redelivery', async () => {
    let called = 0
    const message = {
      info: { deliveryCount: 1 },
      term: () => {},
      nak: () => {},
    } as unknown as Parameters<typeof settleByDeliveryBudget>[0]
    await settleByDeliveryBudget(message, {
      ...opts,
      onPoison: async () => {
        called += 1
      },
    })
    expect(called).toBe(0)
  })

  it('still terms when the sink itself fails, but surfaces the recording failure', async () => {
    // A broken sink must not strand the message in redelivery forever, and must not be silent
    // either — the whole point is that a loss is findable.
    const order: string[] = []
    const message = {
      info: { deliveryCount: 5 },
      term: () => order.push('term'),
      nak: () => order.push('nak'),
    } as unknown as Parameters<typeof settleByDeliveryBudget>[0]
    const outcome = await settleByDeliveryBudget(message, {
      ...opts,
      onPoison: async () => {
        throw new Error('db down')
      },
    })
    expect([order, outcome]).toEqual([['term'], { terminated: true, recorded: false }])
  })
})

describe('a failed poison record is never silent', () => {
  it('writes the unrecorded loss to stderr, so ignoring the return value still cannot hide it', async () => {
    const written: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    const message = {
      info: { deliveryCount: 5 },
      subject: 'qaroom.identity.user.comm_1.erased',
      headers: { get: () => 'evt_1' },
      json: () => ({}),
      term: () => {},
      nak: () => {},
    } as unknown as Parameters<typeof settleByDeliveryBudget>[0]
    await settleByDeliveryBudget(message, {
      max: 5,
      poisonReason: 'poison',
      onPoison: async () => {
        throw new Error('db down')
      },
    })
    process.stderr.write = original
    expect(written.join('')).toMatch(/qaroom\.identity\.user\.comm_1\.erased/)
  })
})
