import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { idempotencyKeyFrom } from './http'

/** A minimal request carrying only the header surface `idempotencyKeyFrom` reads. */
function reqWith(idempotencyKey: string | string[] | undefined): FastifyRequest {
  return { headers: { 'idempotency-key': idempotencyKey } } as unknown as FastifyRequest
}

describe('idempotencyKeyFrom', () => {
  it('parses a present single-valued Idempotency-Key header into a branded key', () => {
    expect(idempotencyKeyFrom(reqWith('idem-123'))).toBe('idem-123')
  })

  it('takes the first value of a repeated (array) header', () => {
    expect(idempotencyKeyFrom(reqWith(['first-key', 'second-key']))).toBe('first-key')
  })

  it('throws a ZodError when the header is absent (the handler maps this to a 400)', () => {
    expect(() => idempotencyKeyFrom(reqWith(undefined))).toThrow(ZodError)
  })

  it('throws a ZodError when the header is the empty string (min length 1)', () => {
    expect(() => idempotencyKeyFrom(reqWith(''))).toThrow(ZodError)
  })
})
