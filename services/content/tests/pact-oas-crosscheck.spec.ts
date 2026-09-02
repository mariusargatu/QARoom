import { resolve } from 'node:path'
import { crosscheckInteraction, pactInteractions } from '@qaroom/testing-utils/contract-crosscheck'
import { describe, expect, it } from 'vitest'

/**
 * Triangulation (Commitment 3): assert every Pact interaction the gateway expects from
 * content-service is consistent with content-service's PUBLISHED OpenAPI contract. Catches the gap Pact
 * alone misses (a consumer expectation that drifts from the provider spec) and the gap Schemathesis
 * misses (a contract the consumer relies on that the provider never documented). Pure TS; no Docker
 * — which is why this runs per-PR while `pact:verify` provider verification needs the Docker lane.
 *
 * Interactions are loaded through the shared `pactInteractions` reader, and
 * `scripts/pact-oas-crosscheck.test.ts` fails if any committed pact has no spec like this one.
 */
const OAS = resolve(import.meta.dirname, '..', 'openapi.yaml')
const PACT = resolve(import.meta.dirname, '..', '..', 'gateway', 'pacts', 'gateway-content.json')

describe('gateway pact ↔ content OpenAPI cross-check', () => {
  it.each(
    pactInteractions(PACT),
  )('interaction "$description" matches the content OpenAPI operation it exercises', async (interaction) => {
    const result = await crosscheckInteraction(OAS, interaction)
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })
})
