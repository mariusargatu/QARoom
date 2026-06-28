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
  // `AGENT_PATCH_AROUND_GATE` (Boundary 16, ADR-0032) re-uses the tenancy leak as the bug an agent
  // "patches in" while papering it over with green-theater tests: it loosens the same per-community
  // WHERE predicate the property gate defends. The point of the `gate-survives-agent-gaming` claim is
  // that the invariant property still RED-flags the leak even when a weak-oracle agent test stays
  // green — so the strong gate cannot be gamed. Unguarded, like the other content toggles above.
  tenantLeak: env.CONTENT_BUG_TENANT_LEAK === '1' || env.AGENT_PATCH_AROUND_GATE === '1',
  voteSlowMs: parseVoteSlowMs(env.CONTENT_BUG_VOTE_SLOW_MS),
  syncPublish: env.CHAOS_SYNC_PUBLISH === '1',
  voteOutOfRange: env.CONTENT_BUG_VOTE_OUT_OF_RANGE === '1',
  // The in-range/out-of-set adversary (ADR-0033, spike C6): writes 0, which a range projection of the
  // ±1 rule would admit but the set-membership DB CHECK rejects. Backs the `vote-value-in-set` claim.
  voteOutOfSet: env.CONTENT_BUG_VOTE_OUT_OF_SET === '1',
  // Drop the RLS second tenancy layer at schema-application time (ADR-0035). Backs the
  // `rls-blocks-broken-service-layer` claim: armed, ensureSchema skips the policies, so a broken
  // service-layer WHERE leaks across tenants and the catch-broken-service test reds.
  disableRls: env.CONTENT_BUG_DISABLE_RLS === '1',
  // Skip the GDPR erasure handler (ADR-0036): ack the `user.erased` event without deleting the user's
  // posts/votes, so content still returns the "erased" user. Backs the `user-erased-everywhere` claim
  // (pnpm prove user-erased-everywhere --break) — the cross-service saga reaches Incomplete and the
  // no-service-returns-the-user property reds.
  skipErasure: env.CONTENT_BUG_SKIP_ERASURE === '1',
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
  voteOutOfRange: false,
  voteOutOfSet: false,
  disableRls: false,
  skipErasure: false,
})
