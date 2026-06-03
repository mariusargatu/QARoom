import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { crosscheckInteraction } from '@qaroom/testing-utils/contract-crosscheck'
import { describe, expect, it } from 'vitest'

/**
 * Triangulation (Commitment 3): assert every Pact interaction the gateway expects
 * from content is consistent with content's PUBLISHED OpenAPI contract. Catches the
 * gap Pact alone misses — a consumer expectation that drifts from the provider's
 * spec — and the gap Schemathesis misses — a contract the consumer relies on that
 * the provider never documented. Pure TS; no Docker.
 */
interface PactInteraction {
  description: string
  request: { method: string; path: string }
  // Pact v4 wraps the body as { content, contentType, encoded }.
  response: { status: number; body?: { content?: unknown } }
}

const CONTENT_OAS = resolve(import.meta.dirname, '..', 'openapi.yaml')
const GATEWAY_PACT = resolve(
  import.meta.dirname,
  '..',
  '..',
  'gateway',
  'pacts',
  'gateway-content.json',
)

const pact = JSON.parse(readFileSync(GATEWAY_PACT, 'utf8')) as { interactions: PactInteraction[] }

describe('gateway pact ↔ content OpenAPI cross-check', () => {
  it.each(
    pact.interactions,
  )('interaction "$description" matches the content OpenAPI operation it exercises', async (interaction) => {
    const result = await crosscheckInteraction(CONTENT_OAS, {
      request: { method: interaction.request.method, path: interaction.request.path },
      response: { status: interaction.response.status, body: interaction.response.body?.content },
    })
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })
})
