import type { Clock } from '@qaroom/determinism'
import {
  bodyHash,
  conflictingIdempotencyKey,
  findIdempotent,
  type SqlExecutor,
  storeIdempotent,
} from '@qaroom/messaging/idempotency'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { idempotencyKeyFrom } from './http'
import { problem } from './problem'

export interface IdempotencyOptions {
  db: SqlExecutor
  clock: Clock
  /** Stable route id, part of the replay key — e.g. `POST /api/communities/{communityId}/posts`. */
  route: string
  /** Status to send for a fresh (non-replayed) success. */
  status: number
}

/**
 * The single home for the Idempotency-Key replay dance (Commitment 4) — previously
 * copy-pasted into every mutating route of every service. Behaviour:
 *  - missing / invalid key → 400 (`idempotencyKeyFrom` throws a ZodError the problem handler maps);
 *  - same key + same body → the stored response, WITHOUT re-running `produce`;
 *  - same key + different body → 409 `conflict` (conventions §3 — the previously-missing case);
 *  - otherwise run `produce`, persist the result keyed by `(key, route, body_hash)`, and send it.
 *
 * `produce` returns the response body and is the only per-route code; the wrapper owns the rest.
 */
export async function withIdempotency(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: IdempotencyOptions,
  produce: () => Promise<unknown>,
): Promise<void> {
  const key = idempotencyKeyFrom(req)
  const hash = bodyHash(req.body)

  const replayed = await findIdempotent(opts.db, key, opts.route, hash)
  if (replayed) {
    reply.code(replayed.status).send(replayed.body)
    return
  }
  if (await conflictingIdempotencyKey(opts.db, key, opts.route, hash)) {
    throw problem({
      slug: 'idempotency-key-conflict',
      title: 'Idempotency-Key reused with a different body',
      status: 409,
      failure_domain: 'conflict',
      detail: 'This Idempotency-Key was already used for a request with a different body.',
      next_actions: [
        { verb: 'POST', href: opts.route, description: 'Retry with a fresh Idempotency-Key.' },
      ],
    })
  }

  const body = await produce()
  await storeIdempotent(
    opts.db,
    { key, route: opts.route, hash, status: opts.status, body },
    opts.clock.now(),
  )
  reply.code(opts.status).send(body)
}
