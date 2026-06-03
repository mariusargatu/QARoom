import type { Clock } from '../types'

/** Production Clock backed by OS wall time. The ONLY sanctioned `new Date()` site. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
