import { z } from 'zod'
import { CommunityId, DonationId, EventId, UserId } from '../ids'

/**
 * FROZEN v1 shape of `DonationStateChangedEvent` (Milestone 5). The `status` enum is INLINED
 * (not imported from `../donation`) so this record stays byte-stable if `DonationStatus`
 * later gains members. The compat test asserts a current producer's output still parses here
 * (conventions §2). Deliberately NOT registered (`no .meta({ id })`).
 */
export const DonationStateChangedEventV1 = z.object({
  event_id: EventId,
  community_id: CommunityId,
  donation_id: DonationId,
  donor_id: UserId,
  amount_cents: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(['Pending', 'Authorized', 'Captured', 'Failed', 'Refunded']),
  occurred_at: z.iso.datetime(),
})
export type DonationStateChangedEventV1 = z.infer<typeof DonationStateChangedEventV1>
