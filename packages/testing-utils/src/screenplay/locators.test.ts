import { describe, expect, it } from 'vitest'
import { LOC, locateTestId, role } from './locators'

// The LOC registry feeds the testid-only Screenplay UiDriver (ADR-0027). These guard the two things
// that would silently break the dual-context contract: a registry entry resolving to the wrong id, and
// the resolver quietly accepting a richer locator the seam can't serve.

describe('locateTestId', () => {
  it('resolves a testId Loc through the driver getByTestId', () => {
    const calls: string[] = []
    const driver = { getByTestId: (id: string) => calls.push(id) }

    locateTestId(driver, LOC.rollout.advance('EnableRequested'))

    expect(calls).toEqual(['rollout-advance-EnableRequested'])
  })

  it('throws on a non-testId locator the testid-only driver cannot serve', () => {
    const driver = { getByTestId: () => undefined }

    expect(() => locateTestId(driver, role('button', 'Upvote'))).toThrow(/testId locators only/)
  })
})
