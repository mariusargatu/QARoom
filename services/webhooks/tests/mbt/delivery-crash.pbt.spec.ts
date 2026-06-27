import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  commitFailure,
  crashMidAttempt,
  deliveryCommandArbitraries,
  freshModel,
  freshReal,
  MAX,
  reclaimable,
} from './crash-commands'

/**
 * MBT × fault composition (T19, ADR-0024 Phase 3): model-based command sequences over the
 * webhook-delivery machine, with a crash-mid-transition fault interleaved, must keep every
 * WebhookDelivery.tla invariant on committed state. The command layer (crash-commands.ts) drives the
 * REAL machine runner + the REAL `assertLegalDeliveryCommit` binding + the REAL retry budget, so a
 * red here is a real protocol violation, not a test artefact. This is the deterministic, model-level
 * twin of the full-system crash the DST slice fuzzes (tests/dst, T20).
 */
describe('MBT × fault: webhook delivery survives a crash mid-transition', () => {
  it('every succeed/fail/crash sequence holds NoSilentDrop, ExhaustionLegit, legal-edge, and the at-least-once spine', () => {
    fc.assert(
      fc.property(fc.commands(deliveryCommandArbitraries(), { maxCommands: 12 }), (cmds) => {
        fc.modelRun(() => ({ model: freshModel(), real: freshReal() }), cmds)
      }),
      { numRuns: 200 },
    )
  })

  it('a crash mid-attempt rolls back and leaves the row re-claimable, then real attempts still reach a legal terminal', () => {
    const real = freshReal()

    // One committed failure → Retrying. Then a crash mid-attempt: the committed row must not move.
    commitFailure(real)
    expect(real.status).toBe('Retrying')
    expect(real.attempt).toBe(1)

    const before = real.status
    crashMidAttempt(real)
    expect(real.status, 'crash rolled back; committed state unchanged').toBe(before)
    expect(reclaimable(real.status), 'a crashed delivery stays re-claimable').toBe(true)

    // The re-claimed row drives the machine to a legal terminal without tripping the binding:
    // from Retrying(1), MAX-1 further failures exhaust the budget to DeadLettered(MAX).
    Array.from({ length: MAX - 1 }).forEach(() => {
      commitFailure(real)
    })
    expect(real.status, 'budget exhausted → DeadLettered (ExhaustionLegit holds)').toBe(
      'DeadLettered',
    )
    expect(real.attempt).toBe(MAX)
  })
})
