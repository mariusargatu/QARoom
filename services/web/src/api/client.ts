import {
  Donation,
  DonationList,
  EventPage,
  FlagResolution,
  type RolloutEventName,
} from '@qaroom/contracts'

export interface CreateDonationBody {
  donor_id: string
  amount_cents: number
  currency: string
}

export interface ApiClient {
  resolveFlag(communityId: string, flagKey: string): Promise<FlagResolution>
  advanceRollout(
    communityId: string,
    flagKey: string,
    event: RolloutEventName,
  ): Promise<FlagResolution>
  listDonations(communityId: string): Promise<DonationList>
  createDonation(communityId: string, body: CreateDonationBody): Promise<Donation>
  listEvents(communityId: string, after: number): Promise<EventPage>
}

/**
 * The browser's gateway client. Idempotency keys come from a monotonic counter — NOT
 * `crypto.randomUUID()` or `Date.now()`, which the determinism lint bans even in the browser
 * (Commitment 6): a counter is both unique per logical request and deterministic.
 */
export function createApiClient(baseUrl: string): ApiClient {
  const base = baseUrl.replace(/\/$/, '')
  let counter = 0
  const nextKey = () => {
    counter += 1
    return `web-${counter}`
  }

  async function read<T>(path: string): Promise<T> {
    const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return (await res.json()) as T
  }

  async function write<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': nextKey() },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}`)
    return (await res.json()) as T
  }

  return {
    async resolveFlag(communityId, flagKey) {
      return FlagResolution.parse(await read(`/api/communities/${communityId}/flags/${flagKey}`))
    },
    async advanceRollout(communityId, flagKey, event) {
      return FlagResolution.parse(
        await write(`/api/communities/${communityId}/flags/${flagKey}/rollout`, { event }),
      )
    },
    async listDonations(communityId) {
      return DonationList.parse(await read(`/api/communities/${communityId}/donations`))
    },
    async createDonation(communityId, body) {
      return Donation.parse(await write(`/api/communities/${communityId}/donations`, body))
    },
    async listEvents(communityId, after) {
      return EventPage.parse(await read(`/api/communities/${communityId}/events?after=${after}`))
    },
  }
}
