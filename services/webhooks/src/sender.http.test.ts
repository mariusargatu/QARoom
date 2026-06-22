import { describe, expect, it } from 'vitest'
import { createHttpWebhookSender } from './sender'
import { abortingFetch, networkErrorFetch, recordingFetch } from './sender-http-fake'

/**
 * The production outbound HTTP seam (`createHttpWebhookSender`). The real network is infra, but the
 * sender takes an injectable `fetchImpl`, so every outcome mapping and the request shaping are
 * deterministically unit-testable with an in-memory fetch double — no socket, no upstream server.
 * The contract: a 2xx is `success`; any other status is `http_error`; an abort (the timeout) is
 * `timeout`; any other rejection is `network_error`; and the seam NEVER throws.
 */
const REQ = {
  url: 'https://hooks.example.com/qaroom',
  body: '{"hello":"world"}',
  headers: { 'x-qaroom-signature': 'v1=abc' },
}

describe('createHttpWebhookSender', () => {
  it('maps a 2xx response to a success result carrying the status code', async () => {
    const { fetchImpl } = recordingFetch(202)
    const result = await createHttpWebhookSender(5_000, fetchImpl).send(REQ)
    expect(result).toEqual({ kind: 'success', status: 202 })
  })

  it('maps a non-2xx response to an http_error result carrying the status code', async () => {
    const { fetchImpl } = recordingFetch(503)
    const result = await createHttpWebhookSender(5_000, fetchImpl).send(REQ)
    expect(result).toEqual({ kind: 'http_error', status: 503 })
  })

  it('maps an aborted request (the timeout) to a timeout result', async () => {
    const result = await createHttpWebhookSender(5_000, abortingFetch).send(REQ)
    expect(result).toEqual({ kind: 'timeout' })
  })

  it('maps any other transport failure to a network_error result', async () => {
    const result = await createHttpWebhookSender(5_000, networkErrorFetch).send(REQ)
    expect(result).toEqual({ kind: 'network_error' })
  })

  it('POSTs the body and merges caller headers over a json content-type default with an abort signal', async () => {
    const { calls, fetchImpl } = recordingFetch(200)
    await createHttpWebhookSender(5_000, fetchImpl).send(REQ)
    const call = calls[0]
    expect(call?.url).toBe(REQ.url)
    expect(call?.init.method).toBe('POST')
    expect(call?.init.body).toBe(REQ.body)
    expect(call?.init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-qaroom-signature': 'v1=abc',
    })
    expect(call?.init.signal).toBeDefined()
  })

  it('never throws — a rejected fetch always resolves to a SendResult', async () => {
    await expect(createHttpWebhookSender(5_000, networkErrorFetch).send(REQ)).resolves.toBeDefined()
  })
})
