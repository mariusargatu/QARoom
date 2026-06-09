import { type FlagState, FlagState as FlagStateSchema, rolloutMachine } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { legalEventsFor } from './rollout'

// The machine config is the single source of truth for which events are legal from each state.
// `legalEventsFor` must report exactly that set — so the UI offers only transitions the server
// (which drives the same machine) will accept. We cross-check against the raw config rather than
// hard-coding, then pin a handful of concrete states so a config edit that changes behaviour is
// caught even if the cross-check helper were itself wrong.
const onKeysFromConfig = (state: FlagState): string[] => {
  const states = rolloutMachine.config.states ?? {}
  const on = (states[state] as { on?: Record<string, unknown> } | undefined)?.on ?? {}
  return Object.keys(on)
}

const ALL_FLAG_STATES = FlagStateSchema.options

describe('legalEventsFor', () => {
  it.each(
    ALL_FLAG_STATES,
  )('returns exactly the machine-legal events from the %s state', (state) => {
    expect([...legalEventsFor(state)].sort()).toEqual([...onKeysFromConfig(state)].sort())
  })

  it('offers only EnableRequested from the Off start state', () => {
    expect(legalEventsFor('Off')).toEqual(['EnableRequested'])
  })

  it('offers the confirm-or-abort fork from the mid-rollout Enabling state', () => {
    expect([...legalEventsFor('Enabling')].sort()).toEqual(['CanaryConfirmed', 'RolloutAborted'])
  })

  it('offers the complete-or-abort fork from the mid-rollout Canary state', () => {
    expect([...legalEventsFor('Canary')].sort()).toEqual(['RolloutAborted', 'RolloutCompleted'])
  })

  it('offers only DisableRequested from the fully Enabled state', () => {
    expect(legalEventsFor('Enabled')).toEqual(['DisableRequested'])
  })

  it('offers only DisableCompleted from the terminal-bound Disabling state', () => {
    expect(legalEventsFor('Disabling')).toEqual(['DisableCompleted'])
  })

  it('returns a fresh array on each call so callers cannot mutate the machine view', () => {
    const first = legalEventsFor('Enabling')
    const second = legalEventsFor('Enabling')
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})
