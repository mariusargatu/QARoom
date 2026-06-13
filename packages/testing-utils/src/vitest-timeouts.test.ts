import { describe, expect, it } from 'vitest'
import { contentionAwareTimeout, contentionMultiplier } from './vitest-timeouts'

describe('contentionMultiplier', () => {
  it('stays at 1 on a quiet machine (load below core count)', () => {
    expect(contentionMultiplier(6, 12)).toBe(1)
  })

  it('scales linearly once load exceeds the core count', () => {
    expect(contentionMultiplier(24, 12)).toBe(2)
  })

  it('clamps at 8x so a pathological loadavg cannot defer hang detection indefinitely', () => {
    expect(contentionMultiplier(200, 12)).toBe(8)
  })

  it('treats zero load as quiet', () => {
    expect(contentionMultiplier(0, 12)).toBe(1)
  })

  it('guards against a zero core count', () => {
    expect(contentionMultiplier(4, 0)).toBe(4)
  })
})

describe('contentionAwareTimeout', () => {
  it('returns at least the base cap', () => {
    expect(contentionAwareTimeout(60_000)).toBeGreaterThanOrEqual(60_000)
  })

  it('never exceeds the 8x clamp', () => {
    expect(contentionAwareTimeout(60_000)).toBeLessThanOrEqual(480_000)
  })
})
