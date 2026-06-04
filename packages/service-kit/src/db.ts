/**
 * The Postgres pool bound, resolved once. A bounded `max` is a *load-shedding boundary*:
 * under saturation (chaos experiment 04, StressChaos on the PG pod) new work queues behind a
 * bounded set of connections and the readiness probe's `select 1` eventually times out, so the
 * pod flips NotReady and k8s stops routing — a clean shed, not unbounded connection growth or
 * `FATAL: too many connections`. The bound is explicit and tunable via `PG_POOL_MAX` so the
 * deliberate-mitigation-removal demo can unbound it and watch the assertion go red.
 *
 * Lives here (not in a db module) so it carries no drizzle/postgres dependency — service-kit is
 * shared by the DB-less gateway too. Each DB service passes the result to `postgres(conn, { max })`.
 */
import { intFromEnv } from './env'

const DEFAULT_POOL_MAX = 10

export interface DbPoolOptions {
  /** Overrides the env. Defaults to `PG_POOL_MAX`, then `DEFAULT_POOL_MAX`. */
  max?: number
}

export function pgPoolMax(options: DbPoolOptions = {}): number {
  // `intFromEnv` rejects ""/blank/non-numeric (which `Number("")===0` would have turned into a
  // pool that opens no connections and hangs every query) and falls back to DEFAULT_POOL_MAX.
  return options.max ?? intFromEnv('PG_POOL_MAX', DEFAULT_POOL_MAX)
}
