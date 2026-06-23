import { boundCaller, type ClientResponse, type UpstreamClientOptions } from './upstream-call'

/**
 * Thin JWKS client the gateway uses to fetch identity-service's public verification
 * keys. This is the **Pact consumer** for the identity-issuance boundary:
 * `tests/contracts/identity.consumer.spec.ts` exercises this client against a Pact mock
 * and emits `services/gateway/pacts/gateway-identity.json`, which identity verifies as the
 * provider. As of ADR-0025 the gateway DOES verify tokens at the edge for the events read:
 * `token-verifier.ts` consumes this same JWKS client and verifies ES256 locally to enforce
 * membership (the polling analogue of `ws-not-a-member`). This client stays a thin, injectable
 * seam that only fetches the JWKS; the decode/verify lives in the verifier. (The rest of the
 * proxy surface is still unauthenticated per ADR-0022 — edge auth there remains future work.)
 *
 * It now rides the same bounded-timeout seam (`boundCaller` -> `upstreamCall`) as every other
 * upstream client: a partitioned identity-service fast-fails at the upstream timeout instead of
 * hanging the socket to the OS TCP timeout, and a non-JSON 5xx body is returned as raw text rather
 * than throwing. On the happy path (a valid-JSON 200, as the Pact mock answers) `parseBody` is
 * identical to the prior `JSON.parse`, so the emitted contract is byte-identical.
 */
export type JwksResponse = ClientResponse

export interface JwksClient {
  getJwks(): Promise<JwksResponse>
}

export function createJwksClient(baseUrl: string, options: UpstreamClientOptions = {}): JwksClient {
  const call = boundCaller(baseUrl, options)
  return {
    getJwks: () => call({ method: 'GET', path: '/jwks.json' }),
  }
}
