import { describe, expect, it } from 'vitest'
import { assertIdempotentApply } from './dedup-invariant'

/**
 * The boundary projection of spec/tla/Dedup.tla's `NoDoubleApply` safety invariant (ADR-0024,
 * Phase 3; T19). The live consumer enforces the same rule via the `alreadyProcessed` guard before
 * running a handler's effect; the duplicate-delivery property test exercises it end-to-end.
 */
describe('assertIdempotentApply (Dedup.tla binding)', () => {
  it('accepts a first sight: an unrecorded event applies its effect', () => {
    expect(() => assertIdempotentApply({ recorded: false, applying: true })).not.toThrow()
  })

  it('accepts a recognised duplicate: a recorded event is skipped, not applied', () => {
    expect(() => assertIdempotentApply({ recorded: true, applying: false })).not.toThrow()
  })

  it('accepts a no-op delivery (neither recorded nor applying)', () => {
    expect(() => assertIdempotentApply({ recorded: false, applying: false })).not.toThrow()
  })

  it('rejects the double-apply: re-applying the effect for an already-recorded event', () => {
    expect(() => assertIdempotentApply({ recorded: true, applying: true })).toThrow(
      /double-apply.*NoDoubleApply/,
    )
  })
})
