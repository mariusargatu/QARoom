import { getTableName, type Table } from 'drizzle-orm'

/**
 * The deliberately-injected database fault for scenario tests. PGlite never errors, so every
 * service's RFC 7807 internal-error handler branch (the catch that turns an unexpected DB failure
 * into a typed `500 internal_error` problem, never a bare 500) runs nowhere at unit level. This
 * thin drizzle proxy throws a Postgres-shaped error on the FIRST matching operation, making that
 * branch reachable — and the cross-cutting "never a 500 without retryable" invariant falsifiable.
 *
 * Interception is intentionally scoped to the three methods every mutation funnels through —
 * `transaction`, `insert`, `execute` — not the whole fluent builder: those cover the write paths
 * the error branch guards, and a narrow proxy stays robust against drizzle internals. The tx handle
 * passed to `transaction(fn)` is itself wrapped (sharing one match counter), so a fault declared on
 * an `insert` fires even when that insert runs inside the transaction.
 */
export type FailOp = 'transaction' | 'insert' | 'execute'

export interface FailMatcher {
  op: FailOp
  /** For `op:'insert'`, restrict to a table name (e.g. 'posts'). Omitted ⇒ any table. */
  table?: string
  /** 1-based: throw on the Nth matching op. Default 1 (the first). */
  nth?: number
}

/** A Postgres-connection-class error shape (SQLSTATE 57P01, admin_shutdown) for realism. */
export class InjectedDbError extends Error {
  readonly code = '57P01'
  constructor(matcher: FailMatcher) {
    super(`injected db failure on ${matcher.op}${matcher.table ? ` ${matcher.table}` : ''}`)
    this.name = 'InjectedDbError'
  }
}

const tableNameOf = (arg: unknown): string | undefined => {
  try {
    return getTableName(arg as Table)
  } catch {
    return undefined
  }
}

/**
 * Wrap a drizzle db (or tx handle) so the declared operation throws `InjectedDbError` on its Nth
 * occurrence. The unmatched path delegates verbatim to the real db, so a scenario can run several
 * clean operations and fail exactly one.
 */
export function failingDb<Db extends object>(db: Db, matcher: FailMatcher): Db {
  const nth = matcher.nth ?? 1
  // `nth` is 1-based; `?? 1` preserves a 0 or negative, which would make `matched === nth` never hold
  // and silently inject NO fault — a scenario that passes green having tested nothing. Fail loud.
  if (nth < 1) {
    throw new Error(`failingDb matcher \`nth\` is 1-based and must be >= 1, got ${nth}`)
  }
  const state = { matched: 0 }

  const trip = (op: FailOp, table?: string): boolean => {
    if (op !== matcher.op) return false
    if (matcher.table !== undefined && table !== matcher.table) return false
    state.matched += 1
    return state.matched === nth
  }

  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, prop, receiver) {
        const orig = Reflect.get(t, prop, receiver)
        if (typeof orig !== 'function') return orig

        if (prop === 'transaction') {
          return (fn: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => {
            if (trip('transaction')) return Promise.reject(new InjectedDbError(matcher))
            return (orig as (...a: unknown[]) => unknown).call(
              t,
              (realTx: object) => fn(wrap(realTx)),
              ...rest,
            )
          }
        }

        if (prop === 'insert') {
          return (table: unknown) => {
            // Only resolve the table name when the matcher filters on one — `trip` ignores the arg
            // otherwise, so the getTableName introspection would be wasted on every insert.
            const name = matcher.table === undefined ? undefined : tableNameOf(table)
            if (trip('insert', name)) throw new InjectedDbError(matcher)
            return (orig as (...a: unknown[]) => unknown).call(t, table)
          }
        }

        if (prop === 'execute') {
          return (...args: unknown[]) => {
            if (trip('execute')) return Promise.reject(new InjectedDbError(matcher))
            return (orig as (...a: unknown[]) => unknown).apply(t, args)
          }
        }

        return (orig as (...a: unknown[]) => unknown).bind(t)
      },
    })

  return wrap(db)
}
