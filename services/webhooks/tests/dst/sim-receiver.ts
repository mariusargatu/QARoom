import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookEventType,
} from '@qaroom/contracts'
import { SeededRandomness } from '@qaroom/testing-utils/determinism'
import type { SendResult, WebhookSender, WebhookSendRequest } from '../../src/sender'
import type { Coverage, EndpointProfile, PostRecord } from './types'

/**
 * The SIMULATED WORLD's receivers (DST component 4): a `WebhookSender` double whose endpoints are
 * flaky in seeded, reproducible ways. It is NOT a rebuilt double — it implements the SAME single
 * outbound boundary (`WebhookSender`, services/webhooks/src/sender.ts) production wires to real
 * `fetch`, so the worker under test is byte-for-byte the production worker; only the network is
 * simulated.
 *
 * Every POST is recorded (delivery id, header id, timestamp, signature, body, result) — the raw
 * material the invariant checker replays. The reply is a pure function of (endpoint profile,
 * how many times this delivery has been attempted, the seeded RNG), so the whole receiver is
 * deterministic per seed: the meta-test (`runTwiceAndDiff`) depends on it.
 */

const SUCCESS: SendResult = { kind: 'success', status: 200 }
const HTTP_ERROR_CODES = [500, 502, 503] as const

export class SimReceiver implements WebhookSender {
  readonly posts: PostRecord[] = []
  readonly #profiles = new Map<string, EndpointProfile>()
  /** Attempts seen per canonical delivery id — lets `slow` recover after a fixed number of tries. */
  readonly #attemptsByDelivery = new Map<string, number>()
  readonly #rng: SeededRandomness
  readonly #coverage: Coverage

  constructor(seed: number, coverage: Coverage) {
    this.#rng = new SeededRandomness(seed)
    this.#coverage = coverage
  }

  /** Register an endpoint's behaviour profile (called once per subscription at world setup). */
  registerEndpoint(url: string, profile: EndpointProfile): void {
    this.#profiles.set(url, profile)
  }

  async send(req: WebhookSendRequest): Promise<SendResult> {
    const envelope = parseEnvelope(req.body)
    const deliveryId = envelope.delivery_id
    const attemptsSoFar = this.#attemptsByDelivery.get(deliveryId) ?? 0
    this.#attemptsByDelivery.set(deliveryId, attemptsSoFar + 1)

    const profile = this.#profiles.get(req.url) ?? 'healthy'
    const result = this.#reply(profile, attemptsSoFar)

    this.posts.push({
      url: req.url,
      deliveryId,
      headerDeliveryId: req.headers[WEBHOOK_DELIVERY_ID_HEADER] ?? '',
      eventId: req.headers[WEBHOOK_EVENT_ID_HEADER] ?? envelope.event_id,
      eventType: envelope.event_type,
      timestamp: req.headers[WEBHOOK_TIMESTAMP_HEADER] ?? '',
      signature: req.headers[WEBHOOK_SIGNATURE_HEADER] ?? '',
      body: req.body,
      result,
    })
    tallyResult(this.#coverage, result)
    return result
  }

  /** The seeded reply policy. `attemptsSoFar` is 0 on the first POST for this delivery id. */
  #reply(profile: EndpointProfile, attemptsSoFar: number): SendResult {
    if (profile === 'healthy') return SUCCESS
    if (profile === 'down') return { kind: 'network_error' }
    if (profile === 'slow') {
      // Times out for the first two attempts, then the endpoint comes back.
      return attemptsSoFar < 2 ? { kind: 'timeout' } : SUCCESS
    }
    // flaky: a seeded coin per attempt — mostly accepts, sometimes returns a transient 5xx.
    if (this.#rng.next() < 0.55) return SUCCESS
    const code = HTTP_ERROR_CODES[this.#rng.int(0, HTTP_ERROR_CODES.length - 1)] ?? 503
    return { kind: 'http_error', status: code }
  }
}

interface Envelope {
  delivery_id: string
  event_id: string
  event_type: WebhookEventType
}

/** Read the worker's delivery envelope. The body is always the worker's own JSON — never untrusted. */
function parseEnvelope(body: string): Envelope {
  const parsed = JSON.parse(body) as Partial<Envelope>
  return {
    delivery_id: parsed.delivery_id ?? '',
    event_id: parsed.event_id ?? '',
    event_type: (parsed.event_type ?? 'post.created') as WebhookEventType,
  }
}

function tallyResult(coverage: Coverage, result: SendResult): void {
  if (result.kind === 'success') coverage.sendSuccess += 1
  else if (result.kind === 'http_error') coverage.sendHttpError += 1
  else if (result.kind === 'timeout') coverage.sendTimeout += 1
  else coverage.sendNetworkError += 1
}
