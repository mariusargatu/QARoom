import { z } from 'zod'
import { CommunityId, DonationId, UserId } from './ids'

/**
 * Donation contracts (Milestone 5). A donation is a monetary transaction within a
 * community, gated by the `donations` feature flag and settled through a (Microcks-mocked)
 * payment provider. Amounts are integer minor units (cents) — never floats — so totals are
 * exact and property tests can reason about sums without rounding error.
 */

/**
 * Donation lifecycle. PascalCase nouns. `Pending` → `Authorized` → `Captured` is the happy
 * path; `Failed` is a terminal payment error; `Refunded` follows a `Captured` reversal.
 */
export const DonationStatus = z
  .enum(['Pending', 'Authorized', 'Captured', 'Failed', 'Refunded'])
  .meta({ id: 'DonationStatus', description: 'Lifecycle status of a donation.' })
export type DonationStatus = z.infer<typeof DonationStatus>

/** ISO 4217 alphabetic currency code (three uppercase letters). Shared by the WS + event schemas. */
export const currencyField = () =>
  z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 currency code')

/** A donation within a community. */
export const Donation = z
  .object({
    id: DonationId,
    community_id: CommunityId,
    donor_id: UserId,
    /** Integer minor units (cents). Positive. */
    amount_cents: z.number().int().positive(),
    currency: currencyField(),
    status: DonationStatus,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .meta({ id: 'Donation', description: 'A monetary donation within a community.' })
export type Donation = z.infer<typeof Donation>

/** Request body for createDonation. `.strict()` matches OAS additionalProperties:false. */
export const CreateDonationRequest = z
  .strictObject({
    donor_id: UserId,
    amount_cents: z.number().int().positive(),
    currency: currencyField(),
  })
  .meta({ id: 'CreateDonationRequest', description: 'Body for createDonation.' })
export type CreateDonationRequest = z.infer<typeof CreateDonationRequest>

/** A page of a community's donations, newest first. */
export const DonationList = z
  .object({ community_id: CommunityId, donations: z.array(Donation) })
  .meta({ id: 'DonationList', description: 'A page of a community’s donations.' })
export type DonationList = z.infer<typeof DonationList>
