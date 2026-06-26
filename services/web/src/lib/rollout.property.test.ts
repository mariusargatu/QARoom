import { type FlagState, FlagState as FlagStateSchema, RolloutEventName } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalEventsFor } from './rollout'

// Property tests for `legalEventsFor` (ADR-0005). It reads the legal transitions for a flag state
// straight from the rollout XState machine, so the UI can only offer events the server will accept.
// The example-based `rollout.test.ts` cross-checks the exact set per state; these pin the structural
// laws that must hold for EVERY state: the result is a duplicate-free subset of the declared event
// alphabet, deterministic across calls, and a fresh array the caller cannot use to mutate the
// machine's view. Pure (no DOM/fetch/React) — node env.

const flagStateArb = fc.constantFrom(...FlagStateSchema.options)
const allEventNames = new Set<string>(RolloutEventName.options)
const knownStates = new Set<string>(FlagStateSchema.options)
// Any string the machine does not know as a state. The server drives the same machine, but the UI
// must degrade gracefully if it ever receives a state name it cannot map (forward-compat robustness).
const unknownStateArb = fc.string().filter((s) => !knownStates.has(s))

describe('legalEventsFor invariants', () => {
  it('returns only events drawn from the declared rollout-event alphabet for any state', () => {
    fc.assert(
      fc.property(flagStateArb, (state) => {
        const events = legalEventsFor(state)
        expect(events.every((e) => allEventNames.has(e))).toBe(true)
      }),
    )
  })

  it('never reports a duplicate legal event for any state', () => {
    fc.assert(
      fc.property(flagStateArb, (state) => {
        const events = legalEventsFor(state)
        expect(new Set(events).size).toBe(events.length)
      }),
    )
  })

  it('is deterministic: two calls for the same state return equal event sets', () => {
    fc.assert(
      fc.property(flagStateArb, (state) => {
        expect(legalEventsFor(state)).toEqual(legalEventsFor(state))
      }),
    )
  })

  it('returns a fresh array each call so the machine view cannot be aliased', () => {
    fc.assert(
      fc.property(flagStateArb, (state) => {
        expect(legalEventsFor(state)).not.toBe(legalEventsFor(state))
      }),
    )
  })

  it('isolates the machine view: mutating the returned array does not affect a later call', () => {
    fc.assert(
      fc.property(flagStateArb, (state) => {
        const expected = legalEventsFor(state).length
        const view = legalEventsFor(state)
        view.push('NotAnEvent' as never)
        expect(legalEventsFor(state).length).toBe(expected)
      }),
    )
  })

  it('offers no legal events for any state outside the declared alphabet, and never throws', () => {
    fc.assert(
      fc.property(unknownStateArb, (state) => {
        expect(legalEventsFor(state as FlagState)).toEqual([])
      }),
    )
  })
})
