import { readFileSync } from 'node:fs'
import type { InteractionLike } from './index'

/**
 * Read a committed Pact v4 file and normalize its interactions into `crosscheckInteraction` input.
 *
 * Every `services/<provider>/tests/pact-oas-crosscheck.spec.ts` used to re-declare this Pact-shape
 * interface and re-do the `body.content` unwrap by hand. That copy-paste is exactly how the
 * cross-check came to cover only 2 of the 5 providers — the per-service spec was a file someone had
 * to remember to write, and three were never written. One loader here plus the census gate in
 * `scripts/pact-oas-crosscheck.test.ts` (which fails when a committed pact has no crosscheck spec)
 * makes the omission impossible to repeat silently.
 *
 * Pact v4 wraps a body as `{ content, contentType, encoded }`; `content` is the consumer's pinned
 * example, which is what the OAS schema has to accept.
 */
interface PactBody {
  content?: unknown
}

interface PactInteraction {
  description: string
  request: { method: string; path: string; body?: PactBody }
  response: { status: number; body?: PactBody }
}

/** One interaction, ready for `crosscheckInteraction`, with its description for the test title. */
export interface NamedInteraction extends InteractionLike {
  description: string
}

export function pactInteractions(pactPath: string): NamedInteraction[] {
  const pact = JSON.parse(readFileSync(pactPath, 'utf8')) as { interactions?: PactInteraction[] }
  const interactions = pact.interactions ?? []
  // A pact whose interactions failed to parse would turn `it.each` into a zero-case no-op — green
  // while checking nothing. The committed pacts always have interactions, so an empty list is a bug.
  if (interactions.length === 0) {
    throw new Error(`${pactPath}: no interactions — the cross-check would be vacuously green`)
  }
  return interactions.map((i) => ({
    description: i.description,
    request: { method: i.request.method, path: i.request.path, body: i.request.body?.content },
    response: { status: i.response.status, body: i.response.body?.content },
  }))
}
