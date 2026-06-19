import { test } from '@fast-check/vitest'
import { isPublicHttpsUrl } from '@qaroom/contracts'
import fc from 'fast-check'
import { describe, expect } from 'vitest'

const octet = fc.integer({ min: 0, max: 255 })

/** Generators for hosts the SSRF guard must reject. */
const privateIpv4 = fc.oneof(
  octet.map((d) => `127.0.0.${d}`),
  fc.tuple(octet, octet).map(([c, d]) => `10.0.${c}.${d}`),
  fc.tuple(fc.integer({ min: 16, max: 31 }), octet).map(([b, d]) => `172.${b}.0.${d}`),
  octet.map((d) => `192.168.0.${d}`),
  octet.map((d) => `169.254.169.${d}`),
  octet.map((d) => `100.64.0.${d}`),
)

/**
 * The SSRF guard is a property, not a handful of examples: every non-public destination is
 * rejected, and only public https endpoints are accepted.
 */
describe('SSRF guard', () => {
  test.prop([privateIpv4])('rejects every private/loopback/link-local/CGNAT IPv4 target', (ip) => {
    expect(isPublicHttpsUrl(`https://${ip}/hook`)).toBe(false)
  })

  test.prop([fc.constantFrom('http', 'ftp', 'gopher', 'file')])(
    'rejects any non-https scheme to an otherwise-public host',
    (scheme) => {
      expect(isPublicHttpsUrl(`${scheme}://hooks.example.com/x`)).toBe(false)
    },
  )

  test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
    'rejects embedded credentials even on a public host',
    (user, pass) => {
      const u = encodeURIComponent(user)
      const p = encodeURIComponent(pass)
      expect(isPublicHttpsUrl(`https://${u}:${p}@hooks.example.com/x`)).toBe(false)
    },
  )

  test.prop([fc.constantFrom('hooks.example.com', 'api.partner.io', 'events.acme.co.uk')])(
    'accepts a public https host',
    (host) => {
      expect(isPublicHttpsUrl(`https://${host}/qaroom`)).toBe(true)
    },
  )
})
