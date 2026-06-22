import type { SqlExecutor } from '@qaroom/messaging/idempotency'

/**
 * Test-only in-memory stand-in for the `idempotency_responses` SQL surface that the messaging
 * helpers (`findIdempotent` / `conflictingIdempotencyKey` / `storeIdempotent`) drive. It classifies
 * each drizzle `sql` template by its static text and reads the inlined params, reproducing the
 * exact-match / conflict / `ON CONFLICT DO NOTHING` semantics PGlite gives — so `withIdempotency`'s
 * orchestration is exercised without a live Postgres (PGlite is not resolvable from service-kit; the
 * SQL itself is covered against real PGlite in `@qaroom/messaging`).
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
      if (text.startsWith('SELECT status')) {
        const [key, route, hash] = params as [string, string, string]
        const found = rows.find((r) => r.key === key && r.route === route && r.hash === hash)
        return { rows: found ? [{ status: found.status, response_body: found.body }] : [] }
      }
      if (text.startsWith('SELECT 1 AS one')) {
        const [key, route, hash] = params as [string, string, string]
        const conflict = rows.some((r) => r.key === key && r.route === route && r.hash !== hash)
        return { rows: conflict ? [{ one: 1 }] : [] }
      }
      const [key, route, hash, status, bodyJson] = params as [
        string,
        string,
        string,
        number,
        string,
      ]
      const exists = rows.some((r) => r.key === key && r.route === route && r.hash === hash)
      if (!exists) rows.push({ key, route, hash, status, body: JSON.parse(bodyJson) })
      return { rows: [] }
    },
  }
}
