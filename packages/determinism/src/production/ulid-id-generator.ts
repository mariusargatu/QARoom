import { ulid } from 'ulid'
import type { IdGenerator } from '../types'

/** Production IdGenerator emitting `<prefix>_<ULID>`. */
export class UlidIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${ulid()}`
  }
}
