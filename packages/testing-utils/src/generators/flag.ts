import { FlagState, RolloutEventName } from '@qaroom/contracts'
import fc from 'fast-check'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('')
const SLUG_REST = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')

/** A flag key matching `^[a-z][a-z0-9-]{1,63}$` (leading lowercase letter, then slug chars). */
export const flagKeyArb = fc
  .tuple(
    fc.constantFrom(...LOWER),
    fc.array(fc.constantFrom(...SLUG_REST), { minLength: 1, maxLength: 63 }),
  )
  .map(([head, rest]) => head + rest.join(''))

/** A rollout state — drawn from the `FlagState` contract so it cannot drift from it. */
export const flagStateArb = fc.constantFrom(...FlagState.options)

/** A rollout-advancing event name — drawn from the `RolloutEventName` contract. */
export const rolloutEventNameArb = fc.constantFrom(...RolloutEventName.options)

/** Arbitrary `AdvanceRolloutRequest` body. */
export const advanceRolloutRequestArb = fc.record({ event: rolloutEventNameArb })
