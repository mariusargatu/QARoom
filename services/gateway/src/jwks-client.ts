/**
 * Thin JWKS client the gateway uses to fetch identity-service's public verification
 * keys. This is the **Pact consumer** for the identity-issuance boundary (Milestone 2):
 * `tests/contracts/identity.consumer.spec.ts` exercises this client against a Pact mock
 * and emits `services/gateway/pacts/gateway-identity.json`, which identity verifies as the
 * provider. Token *verification/enforcement* at the gateway is deferred to a later
 * milestone; this milestone consumes the JWKS contract. Keep it a thin, injectable seam.
 */
export interface JwksResponse {
  status: number
  body: unknown
  contentType: string | null
}

export interface JwksClient {
  getJwks(): Promise<JwksResponse>
}

export function createJwksClient(baseUrl: string): JwksClient {
  return {
    async getJwks() {
      const res = await fetch(`${baseUrl}/jwks.json`, { headers: { accept: 'application/json' } })
      const text = await res.text()
      return {
        status: res.status,
        body: text.length > 0 ? JSON.parse(text) : undefined,
        contentType: res.headers.get('content-type'),
      }
    },
  }
}
