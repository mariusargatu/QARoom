import { describe, expect, it } from 'vitest'
import { attributeLeaksPii, findPiiInAttributes, valueLooksLikePii } from './pii'

describe('valueLooksLikePii', () => {
  it('flags an email-shaped string', () => {
    expect(valueLooksLikePii('leaked.user@example.com')).toBe(true)
  })

  it('ignores a community id (tenant discriminator, not PII)', () => {
    expect(valueLooksLikePii('comm_01HZY0K7M3QF8VN2J5RX9TB4CD')).toBe(false)
  })

  it('ignores a non-string value', () => {
    expect(valueLooksLikePii(42)).toBe(false)
  })
})

describe('attributeLeaksPii', () => {
  it('flags a denied key even with an innocuous value', () => {
    expect(attributeLeaksPii('post.body', 'hello world')).toBe(true)
  })

  it('does not flag tenant.id', () => {
    expect(attributeLeaksPii('tenant.id', 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD')).toBe(false)
  })
})

describe('findPiiInAttributes', () => {
  it('returns empty for a clean span', () => {
    const offenders = findPiiInAttributes({
      'tenant.id': 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD',
      'http.route': '/api/communities/{id}/posts',
      'http.response.status_code': 201,
    })
    expect(offenders).toEqual([])
  })

  it('returns each offending key, sorted', () => {
    const offenders = findPiiInAttributes({
      'tenant.id': 'comm_01HZY0K7M3QF8VN2J5RX9TB4CD',
      'user.email': 'leaked.user@example.com',
      'post.body': 'the full body text',
    })
    expect(offenders).toEqual(['post.body', 'user.email'])
  })
})
