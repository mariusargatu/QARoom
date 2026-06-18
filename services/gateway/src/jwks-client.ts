import { boundCaller, type ClientResponse, type UpstreamClientOptions } from './upstream-call'

/**
 * Thin JWKS client the gateway uses to fetch identity-service's public verification
 * keys. This is the **Pact consumer** for the identity-issuance boundary:
 * `tests/contracts/identity.consumer.spec.ts` exercises this client against a Pact mock
 * and emits `services/gateway/pacts/gateway-identity.json`, which identity verifies as the
 * provider. Token *verification/enforcement* at the gateway is deliberately omitted
 * (ADR-0022: the gateway fronts identity unauthenticated; real edge credentials are the
 * parked Milestone 13, which would supersede ADR-0022). The gateway consumes the JWKS
 * contract only and never decodes tokens. Keep it a thin, injectable seam.
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
