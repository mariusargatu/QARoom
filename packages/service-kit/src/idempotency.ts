import type { Clock } from '@qaroom/determinism'
import {
  bodyHash,
  claimIdempotent,
  completeIdempotent,
  conflictingIdempotencyKey,
  findIdempotent,
  releaseIdempotent,
  type SqlExecutor,
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
 *  - same key + same body, CONCURRENTLY → 409 `in-progress`, retryable — exactly one caller runs
 *    `produce`, the rest are told to come back;
 *  - otherwise claim `(key, route, body_hash)`, run `produce`, complete the claim, and send it.
 *
 * `produce` returns the response body and is the only per-route code; the wrapper owns the rest.
 *
 * The claim is what makes this safe under concurrency (2026-08-12). The previous order was
 * check → produce → store, which serialized nothing: two requests with the same key both missed the
 * check and both ran the effect. Ten concurrent same-key requests against a live content-service on
 * real Postgres produced EIGHT posts, all answered 201. A retry that fires because the FIRST attempt
 * has not come back yet is the common case, not an exotic one, so this was the retry boundary
 * failing exactly where it is most needed. `claimIdempotent` makes the INSERT the arbiter instead.
 */
export async function withIdempotency(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: IdempotencyOptions,
  produce: () => Promise<unknown>,
): Promise<void> {
  const key = idempotencyKeyFrom(req)
  const hash = bodyHash(req.body)

  const conflict = () =>
    problem({
      slug: 'idempotency-key-conflict',
      title: 'Idempotency-Key reused with a different body',
      status: 409,
      failure_domain: 'conflict',
      detail: 'This Idempotency-Key was already used for a request with a different body.',
      next_actions: [
        { verb: 'POST', href: opts.route, description: 'Retry with a fresh Idempotency-Key.' },
      ],
    })

  const replayed = await findIdempotent(opts.db, key, opts.route, hash)
  if (replayed) {
    reply.code(replayed.status).send(replayed.body)
    return
  }

  // Claim BEFORE the different-body check, so the check has something to see: two concurrent
  // requests reusing one key with different bodies would otherwise both find nothing and both
  // proceed. The winner's claim row makes the loser's conflict detectable.
  const claim = await claimIdempotent(opts.db, { key, route: opts.route, hash }, opts.clock.now())

  if (claim === 'completed') {
    const stored = await findIdempotent(opts.db, key, opts.route, hash)
    // Completed between our two reads; if it vanished (released or GC'd) say in-progress rather
    // than invent a response.
    if (stored) {
      reply.code(stored.status).send(stored.body)
      return
    }
  }

  if (claim !== 'claimed') {
    throw problem({
      slug: 'idempotency-key-in-progress',
      title: 'A request with this Idempotency-Key is still in progress',
      status: 409,
      failure_domain: 'conflict',
      // Retryable, unlike the reused-key conflict: the SAME key is the right one to retry with —
      // that is the whole point of an idempotent retry — once the in-flight attempt has finished.
      retryable: true,
      detail:
        'An identical request with this Idempotency-Key is already being processed. Retry with the same key to collect its result.',
      next_actions: [
        { verb: 'POST', href: opts.route, description: 'Retry with the SAME Idempotency-Key.' },
      ],
    })
  }

  if (await conflictingIdempotencyKey(opts.db, key, opts.route, hash)) {
    await releaseIdempotent(opts.db, key, opts.route, hash)
    throw conflict()
  }

  let body: unknown
  try {
    body = await produce()
  } catch (error) {
    // A failed attempt must not burn the key until the stale window expires — the caller is
    // expected to retry with it.
    await releaseIdempotent(opts.db, key, opts.route, hash)
    throw error
  }
  await completeIdempotent(
    opts.db,
    { key, route: opts.route, hash, status: opts.status, body },
    opts.clock.now(),
  )
  reply.code(opts.status).send(body)
}
