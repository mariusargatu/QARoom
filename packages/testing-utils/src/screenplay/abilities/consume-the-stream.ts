import type { Ability } from '../ability'

/**
 * A source of WebSocket push frames the Actor can read. Abstracted behind an interface so a
 * test can inject a deterministic in-memory double (the parity test) while real E2E wraps a
 * live socket — neither the Task nor the Question changes.
 */
export interface StreamSource {
  /** Every frame received so far, oldest first. */
  received(): readonly unknown[]
}

/** An ability to read the server→client WebSocket push stream. */
export class ConsumeTheStream implements Ability {
  readonly name = 'ConsumeTheStream'
  readonly #source: StreamSource

  private constructor(source: StreamSource) {
    this.#source = source
  }

  static from(source: StreamSource): ConsumeTheStream {
    return new ConsumeTheStream(source)
  }

  /** All push frames received so far (parsed/validated by the caller via a Question). */
  received(): readonly unknown[] {
    return this.#source.received()
  }
}
