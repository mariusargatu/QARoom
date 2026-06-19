import { EXAMPLE_USER_ID } from '@qaroom/contracts'
import { createSeededDeps } from '@qaroom/testing-utils/harness'
import { describe, expect, it } from 'vitest'
import { TICKET_TTL_MS, type TicketPrincipal, TicketStore } from './ticket-store'

/**
 * The WS-ticket store is the one-use, ≤30s reference seam (ADR-0013): the whole security argument
 * is that a leaked ticket is useless after a single redemption or 30 seconds. Both bounds are
 * measured against the injected Clock, so every path here is deterministic — advance a FakeClock
 * instead of sleeping. These pin the security invariants the store exists to enforce.
 */
const PRINCIPAL: TicketPrincipal = { userId: EXAMPLE_USER_ID, memberships: [] }

const freshStore = () => {
  const { clock, ids } = createSeededDeps()
  return { store: new TicketStore(clock, ids), clock }
}

describe('TicketStore one-use redemption', () => {
  it('redeems a freshly issued ticket to exactly the principal it was minted for', () => {
    const { store } = freshStore()
    const ticket = store.issue(PRINCIPAL)

    expect(store.redeem(ticket)).toEqual({ userId: EXAMPLE_USER_ID, memberships: [] })
  })

  it('rejects a replay of an already-redeemed ticket even while it is still within its lifetime', () => {
    const { store } = freshStore()
    const ticket = store.issue(PRINCIPAL)

    expect(store.redeem(ticket)).not.toBeNull()
    // Clock NOT advanced: the ticket is still valid by time, so only the delete-before-expiry-check
    // ordering can reject this replay.
    expect(store.redeem(ticket)).toBeNull()
  })

  it('redeems to null for a ticket reference it never issued', () => {
    const { store } = freshStore()

    expect(store.redeem('tkt_never_issued')).toBeNull()
  })
})

describe('TicketStore expiry', () => {
  it('still redeems one millisecond before the 30s lifetime elapses', () => {
    const { store, clock } = freshStore()
    const ticket = store.issue(PRINCIPAL)

    clock.advance(TICKET_TTL_MS - 1)

    expect(store.redeem(ticket)).not.toBeNull()
  })

  it('rejects a ticket the instant its 30s lifetime elapses (boundary is inclusive of expiry)', () => {
    const { store, clock } = freshStore()
    const ticket = store.issue(PRINCIPAL)

    clock.advance(TICKET_TTL_MS)

    expect(store.redeem(ticket)).toBeNull()
  })

  it('rejects a ticket long past its lifetime', () => {
    const { store, clock } = freshStore()
    const ticket = store.issue(PRINCIPAL)

    clock.advance(TICKET_TTL_MS * 10)

    expect(store.redeem(ticket)).toBeNull()
  })
})

describe('TicketStore independence', () => {
  it('mints a distinct reference for each issue so tickets never collide', () => {
    const { store } = freshStore()

    expect(store.issue(PRINCIPAL)).not.toBe(store.issue(PRINCIPAL))
  })

  it('sweeps expired entries from the store on issue, keeping only live tickets', () => {
    const { store, clock } = freshStore()
    store.issue(PRINCIPAL)
    store.issue(PRINCIPAL)
    expect(store.size).toBe(2)

    clock.advance(TICKET_TTL_MS)
    // This issue() runs #sweepExpired, evicting both stale tickets; only the fresh one survives.
    // Asserting `size` (not just redeem→null, which redeem's own expiry check would satisfy anyway)
    // is what makes the sweep branch load-bearing — without it a graceless store would hold 3.
    const live = store.issue(PRINCIPAL)

    expect(store.size).toBe(1)
    expect(store.redeem(live)).not.toBeNull()
  })
})
