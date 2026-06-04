import type { Actor } from './actor'

/** A Question reads observable state through the Actor's abilities and returns a value to assert on. */
export interface Question<T> {
  answeredBy(actor: Actor): Promise<T>
}
