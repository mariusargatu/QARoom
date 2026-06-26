import { setup } from 'xstate'

export type DonationGateState = 'Gated' | 'Ready' | 'Donating' | 'Failed'
export type DonationGateEvent =
  | { type: 'RolloutEnabled' }
  | { type: 'RolloutDisabled' }
  | { type: 'DonationSubmitted' }
  | { type: 'DonationSucceeded' }
  | { type: 'DonationFailed' }
export type DonationGateContext = Record<string, never>

/**
 * The rollout-gated donation user flow (Donate page). Donations are hidden until the donations flag
 * reaches Enabled (`RolloutEnabled` -> Ready, mirroring the server gate) and hidden again if the flag
 * is rolled back (`RolloutDisabled` -> Gated). Once Ready, a donation submit goes through Donating to
 * either Ready (success) or Failed (retryable). Invoke-free + context-free for `@xstate/graph` MBT
 * (ADR-0005/0027): the gate transition and the async charge are EXPLICIT events, never an `invoke`.
 * Pairs with the Screenplay `castDonation` Task that drives the same UI in component + E2E tests.
 */
export const donationGateMachine = setup({
  types: { context: {} as DonationGateContext, events: {} as DonationGateEvent },
}).createMachine({
  id: 'donationGate',
  initial: 'Gated',
  context: {},
  states: {
    Gated: { on: { RolloutEnabled: { target: 'Ready' } } },
    Ready: {
      on: {
        RolloutDisabled: { target: 'Gated' },
        DonationSubmitted: { target: 'Donating' },
      },
    },
    Donating: {
      on: {
        DonationSucceeded: { target: 'Ready' },
        DonationFailed: { target: 'Failed' },
      },
    },
    Failed: { on: { DonationSubmitted: { target: 'Donating' } } },
  },
})
