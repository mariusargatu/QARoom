import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Guard for the Schemathesis gate's ONE silent-neutering failure mode (found 2026-08-11).
 *
 * The gate used to pin `--header "Idempotency-Key: schemathesis-gate"`. `withIdempotency` keys
 * replay on `(key, route, body_hash)` and answers a reused key carrying a DIFFERENT body with 409,
 * thrown before `produce()` runs — so after the first successful mutation per route, every later
 * generated mutation short-circuited without touching a repository, the outbox, or the DB. 409 is a
 * declared response, so conformance passed and the gate stayed green. Measured live:
 *
 *   content   with the header: 329 cases,   1 post  +  1 vote   | without: 759 cases, 103 + 59
 *   identity  with the header: 432 cases,   0 users + 1 community | without: 577 cases,  23 + 22
 *
 * A fixed key is indistinguishable from a working gate in CI output, so the regression cannot be
 * caught by reading a green run — it has to be asserted here. The gate is only meaningful while
 * Schemathesis generates the header itself, which requires every mutating operation to declare
 * `Idempotency-Key` as a parameter in its own OAS. Both halves are pinned below.
 */
const ROOT = process.cwd()
const GATE = resolve(ROOT, 'scripts/schemathesis-gate.sh')
const gate = readFileSync(GATE, 'utf8')

/** The services whose OAS the fuzz lanes run against (_integration.yml: fuzz-gateway + fuzz). */
const FUZZED_SERVICES = ['content', 'identity', 'webhooks', 'gateway'] as const

/**
 * Mutating operations that legitimately take no Idempotency-Key, with the reason — not a bare
 * allowlist. Both mint/redeem a one-use WebSocket ticket (ADR-0013), which is not a domain mutation
 * and carries no replay contract; `identity-client.test.ts` pins that the client sends no key.
 */
const NO_KEY_BY_DESIGN: Record<string, string> = {
  'POST /ws/tickets': 'one-use WS ticket mint (ADR-0013) — not a replayable domain mutation',
  'POST /ws/tickets/redeem':
    'internal one-use ticket redemption (ADR-0013) — consumed exactly once',
}

interface Operation {
  parameters?: Array<{ name?: string }>
}

/** Every mutating operation in a service's committed OAS, as "METHOD /path" → its declared params. */
function mutatingOperations(svc: string): Array<[string, Operation]> {
  const doc = parse(readFileSync(resolve(ROOT, `services/${svc}/openapi.yaml`), 'utf8')) as {
    paths: Record<string, Record<string, Operation>>
  }
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, op]): [string, Operation] => [`${method.toUpperCase()} ${path}`, op]),
  )
}

describe('the Schemathesis gate cannot be silently neutered by a static Idempotency-Key', () => {
  it('never pins an Idempotency-Key header on the fuzz run', () => {
    const pinned = gate
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /--header/.test(line) && /idempotency-key/i.test(line))
    expect(pinned, 'a fixed key collapses every mutation after the first into a 409').toEqual([])
  })

  // The assertion above is only worth anything while the script still HAS a fuzz invocation to
  // neuter — a renamed/deleted command would make it vacuously green.
  it('still invokes Schemathesis with the mutation-reaching phases (not vacuously green)', () => {
    expect(gate).toContain('schemathesis/schemathesis:stable run')
    expect(gate).toContain('--phases examples,coverage,fuzzing,stateful')
  })
})

describe.each(
  FUZZED_SERVICES,
)('%s declares Idempotency-Key so the fuzzer can generate one per request', (svc) => {
  it('every mutating operation declares the header, or is a named exception', () => {
    const undeclared = mutatingOperations(svc)
      .filter(([id]) => !(id in NO_KEY_BY_DESIGN))
      .filter(([, op]) => !(op.parameters ?? []).some((p) => p.name === 'Idempotency-Key'))
      .map(([id]) => id)
    expect(
      undeclared,
      'an undeclared header is never generated, so these mutations reach the service without ' +
        'a key and 400 — the gate degrades to testing only the rejection path',
    ).toEqual([])
  })

  it('finds mutating operations at all (a path-shape change would make the check vacuous)', () => {
    expect(mutatingOperations(svc).length).toBeGreaterThan(0)
  })
})
