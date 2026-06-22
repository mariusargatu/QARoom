import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrainLoop } from './drain-loop'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createDrainLoop runs the tick on a fixed interval until stopped', () => {
  it('invokes the tick once per interval', async () => {
    let count = 0
    const stop = createDrainLoop(1000, async () => {
      count += 1
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(count).toBe(3)
    stop()
  })

  it('stops ticking after the returned disposer runs', async () => {
    let count = 0
    const stop = createDrainLoop(1000, async () => {
      count += 1
    })
    await vi.advanceTimersByTimeAsync(2000)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(count).toBe(2)
  })

  it('swallows a rejected tick so it cannot become an unhandled rejection and keeps looping', async () => {
    let count = 0
    const stop = createDrainLoop(1000, async () => {
      count += 1
      throw new Error('tick blew up')
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(count).toBe(2)
    stop()
  })
})
