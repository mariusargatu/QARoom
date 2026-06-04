import type { Ability } from '../ability'

/**
 * An ability to call a service's HTTP API directly (no browser). Used for E2E test setup
 * (seeding a community, advancing a rollout out-of-band) and for the API-side of parity
 * checks. The `fetch` implementation is injected so a test can pass a deterministic double or
 * a Fastify-`inject`-backed fetch; production E2E uses the global `fetch`.
 */
export class CallTheApi implements Ability {
  readonly name = 'CallTheApi'
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  private constructor(baseUrl: string, fetchImpl: typeof fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/, '')
    this.#fetch = fetchImpl
  }

  static at(baseUrl: string, fetchImpl: typeof fetch = fetch): CallTheApi {
    return new CallTheApi(baseUrl, fetchImpl)
  }

  get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.#fetch(`${this.#baseUrl}${path}`, { method: 'GET', headers })
  }

  post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }
}
