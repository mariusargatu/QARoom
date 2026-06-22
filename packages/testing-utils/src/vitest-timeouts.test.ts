import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('applies the floor when instantaneous load is below it', () => {
    expect(contentionMultiplier(6, 12, 2)).toBe(2)
  })

  it('prefers real load over the floor once load exceeds it', () => {
    expect(contentionMultiplier(48, 12, 2)).toBe(4)
  })

  it('still clamps at 8x with a floor set', () => {
    expect(contentionMultiplier(200, 12, 2)).toBe(8)
  })
})

describe('contentionAwareTimeout', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns at least the base cap', () => {
    expect(contentionAwareTimeout(60_000)).toBeGreaterThanOrEqual(60_000)
  })

  it('never exceeds the 8x clamp', () => {
    expect(contentionAwareTimeout(60_000)).toBeLessThanOrEqual(480_000)
  })

  it('floors the cap at 2x base inside a turbo sweep even when loadavg reads near-idle', () => {
    // The sample-too-early race: a suite scheduled first samples a quiet machine. Inside a
    // turbo sweep the floor still grants 2x headroom before the sweep's load shows up.
    vi.stubEnv('TURBO_HASH', 'abc123')
    vi.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0])
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(12).fill({}) as os.CpuInfo[])
    expect(contentionAwareTimeout(60_000)).toBe(120_000)
  })

  it('keeps the tight 1x cap for a solo run (no turbo sweep) on a quiet machine', () => {
    vi.stubEnv('TURBO_HASH', '')
    vi.spyOn(os, 'loadavg').mockReturnValue([0, 0, 0])
    vi.spyOn(os, 'cpus').mockReturnValue(new Array(12).fill({}) as os.CpuInfo[])
    expect(contentionAwareTimeout(60_000)).toBe(60_000)
  })
})
