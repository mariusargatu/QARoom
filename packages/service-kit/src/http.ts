import { IdempotencyKey } from '@qaroom/contracts'
import type { FastifyRequest } from 'fastify'

/** First value of a possibly-array header. */
export function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw
}

/** Parse the branded `Idempotency-Key` header; throws ZodError (→ 400) if missing/invalid. */
export function idempotencyKeyFrom(req: FastifyRequest): IdempotencyKey {
  return IdempotencyKey.parse(headerValue(req.headers['idempotency-key']))
}
