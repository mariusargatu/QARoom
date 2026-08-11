import { resolve } from 'node:path'
import { pactInteractions } from '@qaroom/testing-utils/contract-crosscheck'
import { describe, expect, it } from 'vitest'
import { capturingContent, SAMPLE, setupGatewayTest } from './harness'

/**
 * Route → wire binding: what the gateway ACTUALLY forwards must be what its pact declares.
 *
 * The gap this closes. A Pact request body is hand-authored inside the consumer test — nothing
 * drives it through the route that will send it in production. And the route tests stub the upstream
 * client with a double that ignores its arguments. So the chain
 *
 *     HTTP request → route handler → client method args → wire body
 *
 * had no oracle at any link: a route that dropped, renamed, or reordered a field would satisfy the
 * route tests (the stub ignores args), the consumer pact (its body is written by hand), AND provider
 * verification (which replays that same hand-written body against the provider). Three green gates,
 * a broken proxy.
 *
 * Here the gateway is driven over HTTP with the request the pact pins, and the body the route hands
 * its client is asserted to equal the pact's — so the contract is anchored to the code that has to
 * honour it. Interactions are read from the COMMITTED pact, not restated, so an edit to the consumer
 * spec lands here without anyone remembering to mirror it.
 */
// Deliberately NOT under tests/contracts/: `pact:drift` DELETES services/gateway/pacts and
// re-runs every spec in tests/contracts to regenerate it, so a spec living there that READS the
// committed pact would find nothing on disk and fail the drift gate.
const GATEWAY_PACT = resolve(import.meta.dirname, '..', 'pacts', 'gateway-content.json')

const OK = { status: 200, body: {}, contentType: 'application/json' }

/** The pact interactions that carry a request body — the ones with a forwarding claim to check. */
const withRequestBody = pactInteractions(GATEWAY_PACT).filter((i) => i.request.body !== undefined)

describe('every content interaction the gateway pins is forwarded verbatim by its route', () => {
  it('finds interactions with a request body (a body-less pact would make this vacuous)', () => {
    expect(withRequestBody.length).toBeGreaterThan(0)
  })

  it.each(
    withRequestBody,
  )('the route serving "$description" sends the pact\'s exact body upstream', async (interaction) => {
    const { client, calls } = capturingContent(OK)
    const { request } = setupGatewayTest(client)

    const res = await request.post(interaction.request.path, interaction.request.body, {
      'idempotency-key': 'pact-forwarding',
    })
    // A 4xx here means the gateway rejects the very request its own contract promises to send.
    expect(
      res.status,
      `gateway rejected its own pinned request: ${JSON.stringify(res.json)}`,
    ).toBeLessThan(400)

    expect(calls).toHaveLength(1)
    // `args` is (id, body, idempotencyKey) for both mutating content routes.
    expect(calls[0]?.args[1]).toEqual(interaction.request.body)
  })

  it('forwards the caller-supplied Idempotency-Key rather than inventing one', async () => {
    const { client, calls } = capturingContent(OK)
    const { request } = setupGatewayTest(client)

    await request.post(
      `/api/communities/${SAMPLE.community}/posts`,
      { author_id: SAMPLE.user, title: 't', body: 'b' },
      { 'idempotency-key': 'caller-key-1' },
    )

    expect(calls[0]?.args[2]).toBe('caller-key-1')
  })
})
