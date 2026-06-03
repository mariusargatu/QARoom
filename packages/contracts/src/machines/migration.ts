/**
 * A single reversible migration step. `Tx` is the caller's transaction/executor handle,
 * kept generic so @qaroom/contracts has no Drizzle/pg dependency. Both `up` and `down`
 * are REQUIRED — the idempotency test (docs/05 migration discipline) relies on `down`
 * existing; a migration shipped without a working `down` fails that test.
 */
export interface Migration<Tx> {
  readonly name: string
  up(tx: Tx): Promise<void>
  down(tx: Tx): Promise<void>
}

/**
 * Compose an ordered list of migrations into a single up/down pair. `up` runs in
 * declared order; `down` runs in REVERSE (LIFO) so each step unwinds against the
 * schema state it expected. This is the plain-SQL spine the machine DRIVES, not
 * replaces: the machine is the observable lifecycle; these are the effects the
 * runner invokes on Start / RollbackRequested.
 */
export function composeMigrations<Tx>(migrations: readonly Migration<Tx>[]): {
  up(tx: Tx): Promise<void>
  down(tx: Tx): Promise<void>
} {
  return {
    async up(tx: Tx): Promise<void> {
      for (const m of migrations) await m.up(tx)
    },
    async down(tx: Tx): Promise<void> {
      for (let i = migrations.length - 1; i >= 0; i--) {
        const m = migrations[i]
        if (m) await m.down(tx)
      }
    },
  }
}
