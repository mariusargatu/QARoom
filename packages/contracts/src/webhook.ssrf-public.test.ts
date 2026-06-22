import { describe, expect, it } from 'vitest'
import { isPublicHttpsUrl } from './webhook'

/**
 * The SSRF guard's accept path for literal public IP addresses. The existing suite covers
 * DNS names and the private/loopback/link-local rejections; these pin the two `return false`
 * branches of the private-address classifiers (a public v4/v6 literal is NOT private), so a
 * future over-broad rule that started rejecting legitimate public IP targets fails here.
 */
describe('isPublicHttpsUrl accepts public IP literals', () => {
  it('accepts a public IPv4 literal host', () => {
    expect(isPublicHttpsUrl('https://8.8.8.8/ingest')).toBe(true)
    expect(isPublicHttpsUrl('https://203.0.113.10:8443/x')).toBe(true)
  })

  it('accepts a public IPv6 literal host', () => {
    expect(isPublicHttpsUrl('https://[2606:4700:4700::1111]/x')).toBe(true)
  })
})
