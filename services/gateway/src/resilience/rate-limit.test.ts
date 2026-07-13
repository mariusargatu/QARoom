import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { principalKey } from './rate-limit'

/**
 * The rate-limit principal key (ADR-0022: the REST plane is unauthenticated, so the principal is
 * the `X-Principal-Id` header, falling back to the client IP). Tested directly with a minimal
 * request shape so all three keying branches are exercised — header string, repeated header
 * (array, first wins), and the IP fallback when no principal header is present.
 */
const reqWith = (headers: FastifyRequest['headers'], ip: string): FastifyRequest =>
  ({ headers, ip }) as unknown as FastifyRequest

describe('principalKey', () => {
  it('keys on the X-Principal-Id header when present', () => {
    expect(principalKey(reqWith({ 'x-principal-id': 'alice' }, '203.0.113.7'))).toBe(
      'principal:alice',
    )
  })

  it('takes the first value when the principal header is sent more than once', () => {
    expect(principalKey(reqWith({ 'x-principal-id': ['first', 'second'] }, '203.0.113.7'))).toBe(
      'principal:first',
    )
  })

  it('falls back to the client IP when no principal header is present', () => {
    expect(principalKey(reqWith({}, '203.0.113.7'))).toBe('ip:203.0.113.7')
  })
})
