import type { MembershipClaim, UserId } from '@qaroom/contracts'
import type { Clock, IdGenerator } from '@qaroom/determinism'

/** Ticket lifetime: 30 seconds (ADR-0013). The leak window for a stolen ticket is ≤ this and one-use. */
export const TICKET_TTL_MS = 30_000
export const TICKET_TTL_SECONDS = TICKET_TTL_MS / 1000

export interface TicketPrincipal {
  userId: UserId
  memberships: MembershipClaim[]
}

interface StoredTicket extends TicketPrincipal {
  expiresAtMs: number
}

/**
 * In-memory store of short-lived WebSocket handshake tickets (Milestone 5; Redis in a later
 * milestone). A ticket is a reference, not a credential: it carries no signed claims, so it is
 * useless once redeemed or after 30 seconds. Expiry is measured against the injected Clock —
 * never wall-clock — so the expiry path is deterministically testable by advancing a FakeClock.
 */
export class TicketStore {
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #store = new Map<string, StoredTicket>()

  constructor(clock: Clock, ids: IdGenerator) {
    this.#clock = clock
    this.#ids = ids
  }

  /** Mint a ticket for an authenticated principal. Sweeps expired entries first. */
  issue(principal: TicketPrincipal): string {
    this.#sweepExpired()
    const ticket = this.#ids.next('tkt')
    this.#store.set(ticket, {
      ...principal,
      expiresAtMs: this.#clock.now().getTime() + TICKET_TTL_MS,
    })
    return ticket
  }

  /**
   * Redeem a ticket EXACTLY ONCE. The entry is deleted on any lookup (so a replay finds
   * nothing), and `null` is returned if the ticket is unknown, already redeemed, or expired.
   */
  redeem(ticket: string): TicketPrincipal | null {
    const entry = this.#store.get(ticket)
    if (!entry) return null
    // Delete first — a replay of even a still-valid ticket must fail.
    this.#store.delete(ticket)
    if (this.#clock.now().getTime() >= entry.expiresAtMs) return null
    return { userId: entry.userId, memberships: entry.memberships }
  }

  #sweepExpired(): void {
    const now = this.#clock.now().getTime()
    for (const [ticket, entry] of this.#store) {
      if (now >= entry.expiresAtMs) this.#store.delete(ticket)
    }
  }
}
