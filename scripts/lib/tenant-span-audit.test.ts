import { describe, expect, it } from 'vitest'
import { type AuditSpan, auditSpans, spanIsFresh } from './tenant-span-audit'

const span = (over: Partial<AuditSpan>): AuditSpan => ({
  service: 'flags',
  operationName: 'outbox.relay.drain',
  startTimeMicros: 1_000_000_000_000_000,
  hasTenantId: true,
  ...over,
})

describe('spanIsFresh', () => {
  it('accepts any span when no cutoff is set', () => {
    expect(spanIsFresh(0, null)).toBe(true)
  })

  it('accepts a span that started at or after the cutoff', () => {
    expect(spanIsFresh(2_000 * 1000, 2_000)).toBe(true)
    expect(spanIsFresh(3_000 * 1000, 2_000)).toBe(true)
  })

  it('rejects a span that started before the cutoff', () => {
    expect(spanIsFresh(1_000 * 1000, 2_000)).toBe(false)
  })
})

describe('auditSpans', () => {
  it('counts every span missing tenant.id when no cutoff is set', () => {
    const r = auditSpans([span({ hasTenantId: true }), span({ hasTenantId: false })], null)
    expect(r.total).toBe(2)
    expect(r.offenders).toBe(1)
    expect(r.offenderLabels).toEqual(['flags :: outbox.relay.drain'])
  })

  it('is clean when every span carries tenant.id', () => {
    const r = auditSpans([span({}), span({})], null)
    expect(r).toEqual({ total: 2, offenders: 0, offenderLabels: [] })
  })

  it('ignores stale clean spans and catches a fresh dropped stamp (the de-flake)', () => {
    // The exact false-THEATER race: a pre-arming clean span plus a post-arming dropped one.
    const cutoffMs = 5_000
    const stale = span({ startTimeMicros: 1_000 * 1000, hasTenantId: true })
    const freshBroken = span({ startTimeMicros: 6_000 * 1000, hasTenantId: false })
    const r = auditSpans([stale, freshBroken], cutoffMs)
    expect(r.total).toBe(1) // only the fresh span is audited
    expect(r.offenders).toBe(1) // and it is caught
  })

  it('a stale dropped stamp does not count once a cutoff excludes it', () => {
    const r = auditSpans([span({ startTimeMicros: 1_000 * 1000, hasTenantId: false })], 5_000)
    expect(r).toEqual({ total: 0, offenders: 0, offenderLabels: [] })
  })
})
