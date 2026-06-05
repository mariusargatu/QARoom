import { describe, expect, it } from 'vitest'
import { webhookDeliveryMachine } from './machines/webhook-delivery.machine'
import { CreateWebhookRequest, isPublicHttpsUrl, WebhookDeliveryStatus } from './webhook'

describe('isPublicHttpsUrl (SSRF guard)', () => {
  it('accepts a public https URL', () => {
    expect(isPublicHttpsUrl('https://hooks.example.com/qaroom')).toBe(true)
    expect(isPublicHttpsUrl('https://api.partner.io:8443/ingest')).toBe(true)
  })

  it.each([
    ['http (not https)', 'http://hooks.example.com/x'],
    ['localhost', 'https://localhost/x'],
    ['*.localhost', 'https://evil.localhost/x'],
    ['loopback v4', 'https://127.0.0.1/x'],
    ['loopback v6', 'https://[::1]/x'],
    ['rfc1918 10/8', 'https://10.1.2.3/x'],
    ['rfc1918 172.16/12', 'https://172.20.0.1/x'],
    ['rfc1918 192.168/16', 'https://192.168.1.1/x'],
    ['link-local / metadata', 'https://169.254.169.254/latest/meta-data'],
    ['cgnat 100.64/10', 'https://100.64.0.1/x'],
    ['unspecified 0.0.0.0', 'https://0.0.0.0/x'],
    ['ipv6 ULA', 'https://[fd00::1]/x'],
    ['ipv6 link-local', 'https://[fe80::1]/x'],
    ['ipv4-mapped private', 'https://[::ffff:10.0.0.1]/x'],
    ['credentials in url', 'https://user:pass@hooks.example.com/x'],
    ['k8s service (.svc)', 'https://postgres.default.svc/x'],
    ['k8s fqdn (.cluster.local)', 'https://qaroom-nats.observability.svc.cluster.local/x'],
    ['cloud .internal', 'https://metadata.google.internal/x'],
    ['trailing-dot localhost', 'https://localhost./x'],
    ['not a url', 'not-a-url'],
  ])('rejects %s', (_label, url) => {
    expect(isPublicHttpsUrl(url)).toBe(false)
  })
})

describe('CreateWebhookRequest', () => {
  it('parses a valid body', () => {
    const parsed = CreateWebhookRequest.parse({
      url: 'https://hooks.example.com/qaroom',
      event_types: ['post.created', 'donation.state.changed'],
    })
    expect(parsed.event_types).toHaveLength(2)
  })

  it('rejects an SSRF target url', () => {
    expect(() =>
      CreateWebhookRequest.parse({ url: 'https://127.0.0.1/x', event_types: ['post.created'] }),
    ).toThrow()
  })

  it('rejects an empty event_types list', () => {
    expect(() =>
      CreateWebhookRequest.parse({ url: 'https://hooks.example.com/x', event_types: [] }),
    ).toThrow()
  })

  it('rejects unknown properties (strict)', () => {
    expect(() =>
      CreateWebhookRequest.parse({
        url: 'https://hooks.example.com/x',
        event_types: ['post.created'],
        extra: true,
      }),
    ).toThrow()
  })
})

describe('WebhookDeliveryStatus contract', () => {
  it('matches the delivery machine states exactly', () => {
    const machineStates = Object.keys(webhookDeliveryMachine.config.states ?? {}).sort()
    expect([...WebhookDeliveryStatus.options].sort()).toEqual(machineStates)
  })
})
