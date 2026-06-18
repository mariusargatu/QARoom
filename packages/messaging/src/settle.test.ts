import { describe, expect, it } from 'vitest'
import { deliveryBudgetSettlement } from './settle'

const opts = { max: 5, poisonReason: 'exceeded delivery budget' }

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
