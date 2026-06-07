import { z } from 'zod'

/**
 * The falsifiable-claim manifest — the ONE new source of truth for QARoom's demoability (see
 * docs/adr when committed). Every audience surface (the `pnpm prove` CLI, the skimmer matrix, the
 * README badge, llms.txt) is a drift-gated PROJECTION of this array — the repo's own
 * one-source→many-projections pattern, dogfooded onto its own story.
 *
 * The atom is a FALSIFIABLE CLAIM in one grammar:
 *   "<claim>. Breaks when <toggle>. Caught by <gate>. Evidence: <live value from summary.json>."
 *
 * The `toggle` is the bridge between audiences: a skimmer READS "breaks when CHAOS_WEBHOOK_…", a
 * runner EXECUTES `pnpm prove <id> --break` (which sets that exact env var and re-runs the gate). A
 * claim is only honest if its gate goes RED when the toggle is set — `pnpm claims:verify` proves
 * that empirically, so the manifest can never decay into theater.
 */

/** The nine architectural boundaries (docs/02). A claim defends exactly one. */
export const BOUNDARIES = [
  'trust',
  'process-rest',
  'process-async',
  'tenancy',
  'temporal',
  'external-dep',
  'observability',
  'websocket',
  'identity-issuance',
  'meta',
] as const

/** A runnable gate — the guarantee test that goes RED when the claim's toggle is set. */
export const Gate = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
})
export type Gate = z.infer<typeof Gate>

/** A live-evidence selector into the frozen test-results/summary.json. Never a hand-typed number. */
export const Evidence = z.object({
  runner: z.string(),
  field: z.enum(['passed', 'failed', 'skipped']),
})
export type Evidence = z.infer<typeof Evidence>

export const Claim = z
  .object({
    /** kebab-case id, the `pnpm prove <id>` handle. */
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The one-sentence assertion. */
    claim: z.string().min(1),
    boundary: z.enum(BOUNDARIES),
    technique: z.string().min(1),
    /** EXACT deliberate-bug env var. `claims:verify` confirms a real service reads it. */
    toggle: z.string().regex(/^[A-Z0-9_]+$/),
    /** The guarantee test that holds without the toggle and breaks with it. */
    gate: Gate,
    /** Live evidence pointer into summary.json. */
    evidence: Evidence,
    /** Lowest tier that can prove it: offline (read summary) | simulate (in-process) | live (cluster). */
    tier: z.enum(['offline', 'simulate', 'live']),
  })
  .strict()
export type Claim = z.infer<typeof Claim>

// Phase-1 flagship claims. Each verified to genuinely falsify via env toggle (the guarantee test
// reads the toggle from env, so setting it turns that exact test RED). Distinct boundaries, two
// services, two languages — proving the mechanic generalizes before scaling to one-per-boundary.
const RAW: Claim[] = [
  {
    id: 'webhook-signing',
    claim:
      'A webhook signature binds the timestamp, so a captured (body, signature) pair cannot be replayed.',
    boundary: 'trust',
    technique: 'property test (HMAC-SHA256, timestamp-bound)',
    toggle: 'CHAOS_WEBHOOK_SIGN_BODY_ONLY',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/webhooks',
        'exec',
        'vitest',
        'run',
        '-t',
        'binds the timestamp into the signature',
      ],
    },
    evidence: { runner: '@qaroom/webhooks', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'webhook-at-least-once',
    claim:
      'Every webhook delivery reaches a terminal state; a failed send is retried, never silently dropped.',
    boundary: 'process-async',
    technique: 'property test over generated receiver-failure sequences',
    toggle: 'CHAOS_WEBHOOK_DROP_ON_FAIL',
    gate: {
      cmd: 'pnpm',
      args: [
        '--filter',
        '@qaroom/webhooks',
        'exec',
        'vitest',
        'run',
        '-t',
        'every delivery reaches a terminal state',
      ],
    },
    evidence: { runner: '@qaroom/webhooks', field: 'passed' },
    tier: 'simulate',
  },
  {
    id: 'moderator-abstain',
    claim:
      'The moderator escalates to a human on a low-confidence verdict instead of guessing (FR5 calibration).',
    boundary: 'external-dep',
    technique: 'deterministic workflow test (no LLM, no cluster)',
    toggle: 'MODERATOR_DISABLE_ABSTAIN',
    gate: {
      cmd: 'uv',
      args: [
        'run',
        'pytest',
        '-q',
        'tests/test_workflow_decision.py',
        '-k',
        'low_confidence_draft_escalates',
      ],
      cwd: 'services/moderator-agent',
    },
    evidence: { runner: 'moderator', field: 'passed' },
    tier: 'simulate',
  },
]

/** The validated manifest. Throws at import if any claim violates the schema. */
export const CLAIMS: readonly Claim[] = z.array(Claim).parse(RAW)

export function claimById(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id)
}
