/**
 * A broker (NATS publisher) double for scenario tests. Shaped structurally to satisfy
 * `@qaroom/messaging`'s `EventPublisher` (`publish(subject, payload, headers)`) without importing it
 * — testing-utils has no messaging dependency by design. The relay (`createRelay`) accepts any
 * structurally-matching publisher, so this drops straight in.
 *
 * Three modes mirror the scenario vocabulary:
 *  - `up`   — records the message and resolves (a healthy broker).
 *  - `down` — rejects every publish. Under the transactional outbox (Commitment 17) the relay leaves
 *             the row PENDING (attempts++), so the event is never lost — the scenario asserts exactly
 *             that retention, plus that the originating request still returned its typed response.
 *  - `slow` — neither resolves nor rejects until `flush()` is called: models broker latency the
 *             outbox is supposed to absorb, deterministically (the test decides when it drains).
 */
export type BrokerMode = 'up' | 'down' | 'slow'

export interface PublishedMessage {
  subject: string
  payload: unknown
  headers: Record<string, string>
}

export interface BrokerDouble {
  publish(subject: string, payload: unknown, headers: Record<string, string>): Promise<void>
  /** Messages that have been (or, under `slow`, were) successfully published. */
  readonly published: PublishedMessage[]
  /** Count of publishes awaiting `flush()` under `slow`. */
  readonly pending: number
  /** Resolve all pending `slow` publishes, recording them as published. No-op for `up`/`down`. */
  flush(): void
}

export function brokerDouble(mode: BrokerMode = 'up'): BrokerDouble {
  const published: PublishedMessage[] = []
  const waiters: Array<{ message: PublishedMessage; resolve: () => void }> = []

  return {
    published,
    get pending() {
      return waiters.length
    },
    flush() {
      // Remove all waiters in one O(n) splice (not a shift-loop, which reindexes per pop), then
      // settle them in FIFO order. `pending` reads 0 immediately, honest if flush is called twice.
      for (const waiter of waiters.splice(0)) {
        published.push(waiter.message)
        waiter.resolve()
      }
    },
    publish(subject, payload, headers) {
      const message: PublishedMessage = { subject, payload, headers }
      if (mode === 'down') {
        return Promise.reject(new Error('broker down'))
      }
      if (mode === 'slow') {
        return new Promise<void>((resolve) => {
          waiters.push({ message, resolve })
        })
      }
      published.push(message)
      return Promise.resolve()
    },
  }
}
