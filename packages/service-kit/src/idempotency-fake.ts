import { IDEMPOTENCY_IN_FLIGHT, type SqlExecutor } from '@qaroom/messaging/idempotency'

/**
 * Test-only in-memory stand-in for the `idempotency_responses` SQL surface that the messaging
 * helpers (`findIdempotent` / `conflictingIdempotencyKey` / `claimIdempotent` /
 * `completeIdempotent` / `releaseIdempotent`) drive. It classifies each drizzle `sql` template by
 * its static text and reads the inlined params, reproducing the exact-match / conflict /
 * claim-wins-once semantics real Postgres gives — so `withIdempotency`'s orchestration is exercised
 * without a live server (PGlite is not resolvable from service-kit; the SQL itself is covered
 * against real PGlite in `@qaroom/messaging`, and the CONCURRENCY semantics against real Postgres in
 * `idempotency-concurrency.spec.ts`, which is the only place they can be observed at all).
 *
 * The claim INSERT is modelled as it behaves: it returns a row only for the caller that actually
 * created it, which is the property `withIdempotency` now relies on for mutual exclusion.
 *
 * Lives OUTSIDE a `*.test.ts` on purpose: the SQL router needs branching, which the
 * `no-conditional-in-test` rule (rightly) forbids in test bodies. Excluded from the coverage gate as
 * a test double, not production code.
 */
interface StoredRow {
  key: string
  route: string
  hash: string
  status: number
  body: unknown
}

export function inMemoryIdempotencyDb(): SqlExecutor {
  const rows: StoredRow[] = []
  const find = (key: string, route: string, hash: string) =>
    rows.find((r) => r.key === key && r.route === route && r.hash === hash)

  return {
    async execute(query: unknown) {
      const chunks = (query as { queryChunks: unknown[] }).queryChunks
      let text = ''
      const params: unknown[] = []
      for (const chunk of chunks) {
        if (chunk && typeof chunk === 'object' && chunk.constructor?.name === 'StringChunk') {
          text += (chunk as { value: string[] }).value.join('')
        } else {
          params.push(chunk)
        }
      }

      // findIdempotent — completed rows only; an in-flight claim is a reservation, not a response.
      if (text.startsWith('SELECT status, response_body')) {
        const [key, route, hash] = params as [string, string, string]
        const found = find(key, route, hash)
        return {
          rows:
            found && found.status !== IDEMPOTENCY_IN_FLIGHT
              ? [{ status: found.status, response_body: found.body }]
              : [],
        }
      }

      // claimIdempotent's follow-up read: is the existing row in flight, or complete?
      if (text.startsWith('SELECT status FROM')) {
        const [key, route, hash] = params as [string, string, string]
        const found = find(key, route, hash)
        return { rows: found ? [{ status: found.status }] : [] }
      }

      // conflictingIdempotencyKey — same (key, route), different body.
      if (text.startsWith('SELECT 1 AS one')) {
        const [key, route, hash] = params as [string, string, string]
        const conflict = rows.some((r) => r.key === key && r.route === route && r.hash !== hash)
        return { rows: conflict ? [{ one: 1 }] : [] }
      }

      // claimIdempotent — returns a row ONLY to the caller that created it (the mutual exclusion).
      if (text.startsWith('INSERT INTO idempotency_responses')) {
        const [key, route, hash, status] = params as [string, string, string, number]
        if (find(key, route, hash)) return { rows: [] }
        rows.push({ key, route, hash, status, body: null })
        return { rows: [{ one: 1 }] }
      }

      // claimIdempotent's stale-claim takeover. The fake has no clock, and every test here runs
      // well inside the stale window, so a claim is never reclaimable — which is the behaviour
      // under test (a live claim must NOT be stolen).
      if (text.startsWith('UPDATE idempotency_responses SET created_at')) {
        return { rows: [] }
      }

      // completeIdempotent — write the real response over the claim.
      if (text.startsWith('UPDATE idempotency_responses')) {
        const [status, bodyJson, , key, route, hash] = params as [
          number,
          string,
          string,
          string,
          string,
          string,
        ]
        const found = find(key, route, hash)
        if (found) {
          found.status = status
          found.body = JSON.parse(bodyJson)
        }
        return { rows: [] }
      }

      // releaseIdempotent — drop an unfinished claim only.
      if (text.startsWith('DELETE FROM idempotency_responses')) {
        const [key, route, hash] = params as [string, string, string]
        const index = rows.findIndex(
          (r) =>
            r.key === key &&
            r.route === route &&
            r.hash === hash &&
            r.status === IDEMPOTENCY_IN_FLIGHT,
        )
        if (index >= 0) rows.splice(index, 1)
        return { rows: [] }
      }

      throw new Error(`inMemoryIdempotencyDb: unrouted SQL — ${text.slice(0, 60)}`)
    },
  }
}
