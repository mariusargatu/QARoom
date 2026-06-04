import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import { EXAMPLE_COMMUNITY_ID, EXAMPLE_DONATION_ID, EXAMPLE_USER_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createDonationsClient } from '../../src/donations-client'

/**
 * Consumer-driven contract (Pact) for the gateway → donations-service proxy path (Milestone 6).
 * Running this against the Pact mock emits `services/gateway/pacts/gateway-donations.json`,
 * which donations-service verifies as the provider (services/donations/tests/contracts/provider.verify.ts).
 * It also exercises the real `donations-client` fetch path (timeout + breaker seam) against the mock.
 */
const { like, integer, boolean, string, regex, eachLike } = MatchersV3

const COMMUNITY = EXAMPLE_COMMUNITY_ID
const USER = EXAMPLE_USER_ID
const EXISTING_DONATION = EXAMPLE_DONATION_ID
const MISSING_DONATION = 'dntn_01HZY0K7M3QF8VN2J5RX9TB4XX'

// Hand-authored regexes: the deliberate independent second source (docs/03 §6), not derived
// from contracts.
const DNTN_RE = '^dntn_[0-9A-HJKMNP-TV-Z]{26}$'
const COMM_RE = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'
const USER_RE = '^user_[0-9A-HJKMNP-TV-Z]{26}$'
const STATUS_RE = '^(Pending|Authorized|Captured|Failed|Refunded)$'
const CURRENCY_RE = '^[A-Z]{3}$'
const ISO_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'

const donationBody = {
  id: regex(DNTN_RE, EXISTING_DONATION),
  community_id: regex(COMM_RE, COMMUNITY),
  donor_id: regex(USER_RE, USER),
  amount_cents: integer(2500),
  currency: regex(CURRENCY_RE, 'USD'),
  status: regex(STATUS_RE, 'Captured'),
  created_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
  updated_at: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
}

const pact = new PactV4({
  consumer: 'gateway',
  provider: 'donations',
  dir: resolve(import.meta.dirname, '../../pacts'),
  logLevel: 'warn',
})

describe('gateway → donations consumer contract', () => {
  it('creates a donation when the feature is enabled', async () => {
    await pact
      .addInteraction()
      .given('donations are enabled for the community', { community_id: COMMUNITY })
      .uponReceiving('a request to create a donation')
      .withRequest('POST', `/api/communities/${COMMUNITY}/donations`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-don-1') })
          .jsonBody({ donor_id: USER, amount_cents: 2500, currency: 'USD' }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like(donationBody)))
      .executeTest(async (mock) => {
        const res = await createDonationsClient(mock.url).createDonation(
          COMMUNITY,
          { donor_id: USER, amount_cents: 2500, currency: 'USD' },
          'idem-don-1',
        )
        expect(res.status).toBe(201)
      })
  })

  it('fetches an existing donation', async () => {
    await pact
      .addInteraction()
      .given('a donation exists in the community', {
        id: EXISTING_DONATION,
        community_id: COMMUNITY,
      })
      .uponReceiving('a request to get an existing donation')
      .withRequest('GET', `/api/communities/${COMMUNITY}/donations/${EXISTING_DONATION}`)
      .willRespondWith(200, (b) => b.jsonBody(like(donationBody)))
      .executeTest(async (mock) => {
        const res = await createDonationsClient(mock.url).getDonation(COMMUNITY, EXISTING_DONATION)
        expect(res.status).toBe(200)
      })
  })

  it('receives a 404 problem for a missing donation', async () => {
    await pact
      .addInteraction()
      .given('no such donation exists', { id: MISSING_DONATION, community_id: COMMUNITY })
      .uponReceiving('a request to get a missing donation')
      .withRequest('GET', `/api/communities/${COMMUNITY}/donations/${MISSING_DONATION}`)
      .willRespondWith(404, (b) =>
        b
          .headers({
            'content-type': regex('application/problem\\+json.*', 'application/problem+json'),
          })
          .jsonBody(
            like({
              type: string('https://qaroom.dev/errors/donation-not-found'),
              title: string('Donation not found'),
              status: integer(404),
              retryable: boolean(false),
              failure_domain: string('not_found'),
            }),
          ),
      )
      .executeTest(async (mock) => {
        const res = await createDonationsClient(mock.url).getDonation(COMMUNITY, MISSING_DONATION)
        expect(res.status).toBe(404)
      })
  })

  it('lists a community’s donations', async () => {
    await pact
      .addInteraction()
      .given('a donation exists in the community', {
        id: EXISTING_DONATION,
        community_id: COMMUNITY,
      })
      .uponReceiving('a request to list donations')
      .withRequest('GET', `/api/communities/${COMMUNITY}/donations`)
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            community_id: regex(COMM_RE, COMMUNITY),
            donations: eachLike(donationBody),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createDonationsClient(mock.url).listDonations(COMMUNITY)
        expect(res.status).toBe(200)
      })
  })
})
