import { setup } from 'xstate'

export type VoteState = 'Idle' | 'Pending' | 'Failed'
export type VoteEvent = { type: 'VoteCast' } | { type: 'VoteConfirmed' } | { type: 'VoteRejected' }
export type VoteContext = Record<string, never>

/**
 * The optimistic-vote user flow (CommunityFeed / PostDetail). The UI applies a vote optimistically
 * on `VoteCast` (Pending), then either keeps it on server confirmation (`VoteConfirmed` -> Idle) or
 * rolls it back on rejection (`VoteRejected` -> Failed); a failed vote can be retried with another
 * `VoteCast`. Invoke-free + context-free so it is `@xstate/graph`-traversable for MBT (ADR-0005, the
 * constraint carried over by ADR-0027): the async server round-trip is modeled as EXPLICIT events,
 * never an `invoke`/`after`. Frontend interaction model — lives in the web app, not the cross-service
 * `packages/contracts` machines.
 */
export const voteMachine = setup({
  types: { context: {} as VoteContext, events: {} as VoteEvent },
}).createMachine({
  id: 'vote',
  initial: 'Idle',
  context: {},
  states: {
    Idle: { on: { VoteCast: { target: 'Pending' } } },
    Pending: {
      on: {
        VoteConfirmed: { target: 'Idle' },
        VoteRejected: { target: 'Failed' },
      },
    },
    Failed: { on: { VoteCast: { target: 'Pending' } } },
  },
})
