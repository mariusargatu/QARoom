/**
 * Run `use` against a freshly acquired resource and ALWAYS close it, even on throw. This is the
 * lint-safe home for the try/finally that a property-test predicate cannot contain itself — the
 * `qaroom/no-conditional-in-test` rule bans `try` inside `*.test.ts`, but this helper lives in
 * non-test code.
 *
 * The canonical use is an `it.prop` predicate that needs a fresh per-iteration harness (a PGlite app
 * per fast-check run, for isolation):
 *
 *   test.prop([bodyArb, keyArb], { numRuns: 10 })('idempotent create', (body, key) =>
 *     withResource(() => setupContentTest(), async (ctx) => {
 *       // ... assertions; ctx is closed automatically after this iteration, even on failure ...
 *     }),
 *   )
 *
 * Fresh resource per iteration keeps fast-check isolation; the `finally` guarantees close on a failing
 * iteration or a shrink replay, so a property run can never leak the wasm-backed PGlite instance.
 */
export async function withResource<T extends { close(): Promise<void> }, R>(
  acquire: () => Promise<T>,
  use: (resource: T) => Promise<R>,
): Promise<R> {
  const resource = await acquire()
  try {
    return await use(resource)
  } finally {
    await resource.close()
  }
}
