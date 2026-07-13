import { resolve } from 'node:path'
import { MatchersV3, PactV4 } from '@pact-foundation/pact'
import { EXAMPLE_COMMUNITY_ID } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { createFlagsClient } from '../../src/clients/flags-client'

/**
 * Consumer-driven contract (Pact) for the gateway → flags-service proxy path (Milestone 6).
 * Emits `services/gateway/pacts/gateway-flags.json`, verified by flags-service
 * (services/flags/tests/contracts/provider.verify.ts). No provider state is needed: an
 * unknown flag resolves to its initial `Off` and `EnableRequested` is legal from `Off`.
 */
const { like, integer, boolean, string, regex } = MatchersV3

const COMMUNITY = EXAMPLE_COMMUNITY_ID
const FLAG = 'donations'

const COMM_RE = '^comm_[0-9A-HJKMNP-TV-Z]{26}$'
const SNAP_RE = '^snap_[0-9A-HJKMNP-TV-Z]{26}$'
const STATE_RE = '^(Off|Enabling|Canary|Enabled|Disabling)$'
const ISO_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'

const flagBody = {
  community_id: regex(COMM_RE, COMMUNITY),
  flag_key: string(FLAG),
  state: regex(STATE_RE, 'Off'),
  enabled: boolean(false),
  as_of: like({
    snapshot_id: regex(SNAP_RE, 'snap_01HZY0K7M3QF8VN2J5RX9TB4CL'),
    lamport: integer(0),
    wall_clock: regex(ISO_RE, '2026-01-01T00:00:00.000Z'),
  }),
}

const pact = new PactV4({
  consumer: 'gateway',
  provider: 'flags',
  dir: resolve(import.meta.dirname, '../../pacts'),
  logLevel: 'warn',
})

describe('gateway → flags consumer contract', () => {
  it('resolves a flag', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to resolve a flag')
      .withRequest('GET', `/api/communities/${COMMUNITY}/flags/${FLAG}`)
      .willRespondWith(200, (b) => b.jsonBody(like(flagBody)))
      .executeTest(async (mock) => {
        const res = await createFlagsClient(mock.url).resolveFlag(COMMUNITY, FLAG)
        expect(res.status).toBe(200)
      })
  })

  it('advances a rollout by one event', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request to advance a rollout')
      .withRequest('POST', `/api/communities/${COMMUNITY}/flags/${FLAG}/rollout`, (b) =>
        b
          .headers({ 'content-type': 'application/json', 'Idempotency-Key': like('idem-roll-1') })
          .jsonBody({ event: 'EnableRequested' }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            community_id: regex(COMM_RE, COMMUNITY),
            flag_key: string(FLAG),
            state: regex(STATE_RE, 'Enabling'),
            enabled: boolean(false),
            as_of: like(flagBody.as_of),
          }),
        ),
      )
      .executeTest(async (mock) => {
        const res = await createFlagsClient(mock.url).advanceRollout(
          COMMUNITY,
          FLAG,
          { event: 'EnableRequested' },
          'idem-roll-1',
        )
        expect(res.status).toBe(200)
      })
  })
})
