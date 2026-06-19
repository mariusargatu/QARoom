import type { FaultConfig } from '../deps'

/**
 * The content-service deliberate-bug seam: the single, auditable place the four fault env vars are
 * read. Business logic (`repository/`, `server.ts`) reads the injected `FaultConfig`, never the
 * environment — so the switches are testable without mutating `process.env`, and the attack surface
 * (a tenant-leak toggle, a sync-publish toggle) lives in one file rather than scattered through
 * request handlers.
 *
 * INTENTIONAL EXCEPTION — these reads are UNGUARDED on purpose. flags-service and webhooks-service
 * wrap their demo toggles in a production-mode predicate (the `!== 'production'` env check) so they
 * are inert on deployed pods; content does NOT, because its toggles are *deliberately live*: the
 * detection-matrix cluster tier and the `outbox-isolates-broker-latency` live claim arm them on the
 * production pod and require the bug to actually fire. Adding that production-mode guard here would
 * (a) trip the matrix census (an "unguarded" read site must not reference the production-mode flag),
 * (b) turn the live claim into THEATER, and (c) flip the cluster matrix cells from caught to missed.
 * QARoom is a demonstration platform; production safety for these is operational (never set the
 * `CONTENT_BUG_*` env on a real prod deployment), not a code guard. Do NOT add the production guard.
 *
 * The env-var NAMES and value-semantics are a cross-repo contract (claims/matrix manifests, CI, the
 * live-toggle scripts, rendered docs). Keep them byte-identical: `=== '1'` for the booleans (so an
 * empty string is off), `Number(... ?? 0)` then `> 0` at the call site for the ms switch.
 */
/**
 * Parse the ms switch. Unset/empty => 0 (off), as before. A SET-but-non-numeric value throws loudly
 * rather than coercing to NaN (which `voteSlowMs > 0` would silently treat as off — turning a
 * misconfigured live toggle into a false-negative matrix cell, the THEATER the matrix exists to catch).
 */
function parseVoteSlowMs(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0
  const ms = Number(raw)
  if (!Number.isFinite(ms)) {
    throw new Error(`CONTENT_BUG_VOTE_SLOW_MS must be a number, got ${JSON.stringify(raw)}`)
  }
  return ms
}

export const resolveFaults = (env: NodeJS.ProcessEnv = process.env): FaultConfig => ({
  feedReversed: env.CONTENT_BUG_FEED_REVERSED === '1',
  tenantLeak: env.CONTENT_BUG_TENANT_LEAK === '1',
  voteSlowMs: parseVoteSlowMs(env.CONTENT_BUG_VOTE_SLOW_MS),
  syncPublish: env.CHAOS_SYNC_PUBLISH === '1',
})

/**
 * A clean build: every fault off. The default when `buildApp` is given no `faults`. Frozen — it is the
 * shared default handed to every faults-less app, so a stray mutate-by-reference must not arm a fault
 * across other default-built apps in the process.
 */
export const NO_FAULTS: FaultConfig = Object.freeze({
  feedReversed: false,
  tenantLeak: false,
  voteSlowMs: 0,
  syncPublish: false,
})
