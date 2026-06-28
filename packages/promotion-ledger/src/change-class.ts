/**
 * STATE-AWARE change classification (T24, ADR-0037) — the policy half of auto-revert.
 *
 * QARoom is event-sourced: a reverted migration, a consumed NATS event, a delivered webhook, or a
 * shipped breaking-event CANNOT be un-emitted. So "red ⇒ revert the PR" is only safe for PURE CODE.
 * Every other class freezes `green_head` and pages a human instead of auto-reverting — reverting the
 * code would leave the emitted side effect stranded. This module is the PURE classifier (path
 * signals → class → policy); the auto-revert BOT that acts on it is named as Tier-B in ADR-0037.
 *
 * Classes, most-irreversible first (the first match wins, because any stateful signal forbids an
 * auto-revert regardless of what else the diff also touches):
 *   breaking-event  a versioned event bump (events/*.v2+.ts) — consumers already in flight
 *   migration       a schema migration — DDL already applied forward
 *   state           an XState machine or a TLA+ spec bound to a runtime assertion
 *   contract        a Zod/OpenAPI/AsyncAPI/subject-grammar change — published to other services
 *   pure-code       everything else — the ONLY auto-revertable class
 */

export type ChangeClass = 'pure-code' | 'migration' | 'state' | 'contract' | 'breaking-event'

export type RevertPolicy = 'auto-revert' | 'freeze-and-page'

export interface ChangeClassification {
  readonly class: ChangeClass
  readonly policy: RevertPolicy
  /** The files that drove the class (empty only for a pure-code diff). */
  readonly signals: readonly string[]
}

/** A detector: the file paths that put a diff into a given class. Ordered most-irreversible first. */
const DETECTORS: ReadonlyArray<{ cls: ChangeClass; match: (path: string) => boolean }> = [
  {
    // A versioned event schema at v2 or higher: a breaking event (verdict→disposition was the v2 bump).
    // Consumers may already be reading the old shape, so the emission cannot be taken back.
    cls: 'breaking-event',
    match: (p) => /\/events\/.*\.v([2-9]|\d{2,})\.ts$/.test(p),
  },
  {
    // A schema migration — DDL applied forward against a real database. `migration` in the filename or
    // a `/migrations/` (or `/migrations.ts`) module under contracts/messaging/a service.
    cls: 'migration',
    match: (p) => /(^|\/)migrations?(\.|\/|\b)/.test(p) && /\.(ts|sql)$/.test(p),
  },
  {
    // State: an XState machine (a transition graph other code conforms to) or a TLA+ spec bound to a
    // runtime assertion. Changing either can invalidate in-flight machine state.
    cls: 'state',
    match: (p) => p.startsWith('packages/contracts/src/machines/') || p.startsWith('spec/'),
  },
  {
    // A contract published to other services: the Zod authority, a generated OpenAPI/AsyncAPI doc, or
    // the NATS subject grammar. Reverting it desyncs whoever already consumed the new shape.
    cls: 'contract',
    match: (p) =>
      (p.startsWith('packages/contracts/') && /\.(ts|yaml)$/.test(p)) ||
      /openapi(\.v\d+)?\.yaml$/.test(p) ||
      /asyncapi(\.v\d+)?\.yaml$/.test(p) ||
      /\/subjects\.ts$/.test(p),
  },
]

function policyFor(cls: ChangeClass): RevertPolicy {
  return cls === 'pure-code' ? 'auto-revert' : 'freeze-and-page'
}

/**
 * Classify a changed-file set. Test (`.test.ts` / `.spec.ts`) files never carry a forward side
 * effect, so they never lift a diff out of pure-code — a test-only migration edit is still
 * auto-revertable. The most-irreversible matching class wins.
 */
export function classifyChange(changedFiles: readonly string[]): ChangeClassification {
  const code = changedFiles.filter((p) => !/\.(test|spec)\.[tj]sx?$/.test(p))
  for (const { cls, match } of DETECTORS) {
    const signals = code.filter(match)
    if (signals.length > 0) return { class: cls, policy: policyFor(cls), signals }
  }
  return { class: 'pure-code', policy: 'auto-revert', signals: [] }
}

/** Convenience predicate for the (Tier-B) auto-revert bot: may a red on this diff be auto-reverted? */
export function isAutoRevertable(changedFiles: readonly string[]): boolean {
  return classifyChange(changedFiles).policy === 'auto-revert'
}
