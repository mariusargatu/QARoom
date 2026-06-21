import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * `pnpm moderator:verify` — the CrossHair symbolic-execution gate for the moderator's two safety
 * guarantees (ADR-0024, Phase 2). It runs `crosshair check` over the contracts in
 * `moderator_agent.verify.selfcheck_contracts`, which call the REAL `self_check` decision function:
 *
 *   pnpm moderator:verify            guarded path — CrossHair must find NO counterexample (within the
 *                                    per-condition budget). Exit 0 = the safety contracts hold.
 *   pnpm moderator:verify --falsify  arm each MODERATOR_DISABLE_* toggle in turn and assert CrossHair
 *                                    DOES surface a concrete counterexample. A toggle that produces
 *                                    none is THEATER (the gate has no teeth) — exits non-zero.
 *
 * BOUNDED, not a total proof: "no counterexample within `--per_condition_timeout`". The guarded check
 * resolves well inside its budget; the approve-guard falsifier needs a larger budget because CrossHair
 * must symbolically solve `disposition == 'approve'` together with the divergence + threshold
 * constraints, so the two modes carry different budgets (documented in the ADR).
 */

const MOD_DIR = resolve(process.cwd(), 'services/moderator-agent')
const MODULE = 'moderator_agent.verify.selfcheck_contracts'
const GUARDED_TIMEOUT = '20'
const FALSIFY_TIMEOUT = '45'

interface FalsifyCase {
  toggle: string
  fn: string
  guarantee: string
}

// Each deliberate-bug toggle and the contract function it must break. The fn is targeted directly so
// the symbolic search is scoped to the one guarantee the toggle disables.
const FALSIFY_CASES: FalsifyCase[] = [
  {
    toggle: 'MODERATOR_DISABLE_ABSTAIN',
    fn: 'abstain_escalates_low_confidence',
    guarantee: 'a low-confidence draft escalates to a human (FR5)',
  },
  {
    toggle: 'MODERATOR_DISABLE_APPROVE_GUARD',
    fn: 'never_confidently_approves_flagged',
    guarantee: 'a departing approve never auto-ships — it escalates (FR-safety)',
  },
]

function crosshair(target: string, timeout: string, env: NodeJS.ProcessEnv): number {
  const run = spawnSync(
    'uv',
    ['run', 'crosshair', 'check', target, `--per_condition_timeout=${timeout}`],
    { cwd: MOD_DIR, encoding: 'utf8', env },
  )
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (out) process.stdout.write(`${out}\n`)
  // crosshair exits 2 on an internal/import error — surface that as a hard failure, never a "clean".
  if (run.status === 2) {
    process.stderr.write(
      'crosshair could not run (exit 2) — toolchain/import error, not a verdict\n',
    )
    process.exit(2)
  }
  return run.status ?? 1
}

function runGuarded(): number {
  process.stdout.write(
    `▶ crosshair check ${MODULE} (guarded, budget ${GUARDED_TIMEOUT}s/condition)\n`,
  )
  const status = crosshair(MODULE, GUARDED_TIMEOUT, { ...process.env })
  if (status === 0) {
    process.stdout.write(
      '✓ no counterexample within budget — the self_check safety contracts hold (bounded).\n',
    )
    return 0
  }
  process.stderr.write(
    '✗ CrossHair found a counterexample on the GUARDED path — a safety contract is violated.\n',
  )
  return 1
}

function runFalsify(): number {
  let bad = 0
  for (const c of FALSIFY_CASES) {
    process.stdout.write(`\n▶ arming ${c.toggle}=1 — CrossHair must break: ${c.guarantee}\n`)
    const status = crosshair(`${MODULE}.${c.fn}`, FALSIFY_TIMEOUT, {
      ...process.env,
      [c.toggle]: '1',
    })
    if (status !== 0) {
      process.stdout.write(
        `  ✓ counterexample found — the gate has teeth (${c.toggle} is falsifiable).\n`,
      )
    } else {
      process.stderr.write(
        `  ⚠ NO counterexample for ${c.fn} with ${c.toggle} set within ${FALSIFY_TIMEOUT}s: THEATER.\n`,
      )
      bad += 1
    }
  }
  return bad === 0 ? 0 : 1
}

const wantFalsify = process.argv.includes('--falsify')
process.exit(wantFalsify ? runFalsify() : runGuarded())
