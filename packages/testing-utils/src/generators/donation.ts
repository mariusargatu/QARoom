import { DonationStatus } from '@qaroom/contracts'
import fc from 'fast-check'
import { ulidArb, userIdArb } from './ids'

/** A donation id with the `dntn_` prefix and a valid 26-char Crockford body. */
export const donationIdArb = ulidArb.map((u) => `dntn_${u}`)

/** A positive integer amount in minor units (cents); capped well under int overflow. */
export const amountCentsArb = fc.integer({ min: 1, max: 100_000_00 })

/** A three-letter ISO 4217 currency code from a small, valid set. */
export const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'CAD')

/** A donation lifecycle status — drawn from the `DonationStatus` contract so it cannot drift. */
export const donationStatusArb = fc.constantFrom(...DonationStatus.options)

/** Arbitrary `CreateDonationRequest` body. */
export const createDonationRequestArb = fc.record({
  donor_id: userIdArb,
  amount_cents: amountCentsArb,
  currency: currencyArb,
})
