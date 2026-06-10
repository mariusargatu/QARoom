import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPlan, type GauntletOpts, PHASE_TITLES, type PreflightCtx } from './lib/gauntlet-plan'
import { appendRecord, InfraAbort, runPhase, type StepRecord } from './lib/gauntlet-steps'

/**
 * THE GAUNTLET — one orchestrated run of every testing technique, evidence folded into the one
 * frozen summary envelope, composition observed deliberately. Continue-on-red, fail-at-end:
 * a red gate is a finding, not a stop sign (docs/gauntlet.md has the full execution graph).
 *
 *   pnpm gauntlet                 # all phases
 *   pnpm gauntlet --only 1        # one phase
 *   pnpm gauntlet --from 2        # resume a run that stopped mid-way
 *   pnpm gauntlet --pyrit         # include the PyRIT multi-turn red-team (longest, most spend)
 *
 * Phases 1–2 run without a cluster. Phases 3–9 (cluster/fuzz/chaos/compositions) land next.
 */
const ROOT = process.cwd()
const args = process.argv.slice(2)

const flagValue = (name: string): number | undefined => {
  const idx = args.indexOf(name)
  return idx >= 0 ? Number(args[idx + 1]) : undefined
}
const from = flagValue('--from')
const only = flagValue('--only')
const opts: GauntletOpts = {
  pyrit: args.includes('--pyrit'),
  triangulate: args.includes('--triangulate'),
  reuseCluster: args.includes('--reuse-cluster'),
  down: args.includes('--down'),
}

const has = (tool: string): boolean => spawnSync('which', [tool], { encoding: 'utf8' }).status === 0

// The key lives in the moderator's own gitignored .env (the file pydantic-settings loads), but
// DeepEval/DeepTeam gate on os.environ — so source it into THIS process's env for the spawned
// steps to inherit. Local secret → local child processes, same trust domain; value never logged.
if (!process.env.OPENAI_API_KEY) {
  const envFile = resolve(process.cwd(), 'services/moderator-agent/.env')
  const fromFile = existsSync(envFile)
    ? /^OPENAI_API_KEY=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim()
    : undefined
  if (fromFile) process.env.OPENAI_API_KEY = fromFile
}

const ctx: PreflightCtx = {
  hasDocker: has('docker'),
  hasK3d: has('k3d'),
  hasTilt: has('tilt'),
  hasKubectl: has('kubectl'),
  hasHelm: has('helm'),
  hasJava: has('java'),
  hasTracetest: has('tracetest'),
  hasUv: has('uv'),
  hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
process.stdout.write(`\nTHE GAUNTLET — commit ${commit.slice(0, 8)}\n`)
process.stdout.write('preflight:\n')
for (const [key, value] of Object.entries(ctx)) {
  process.stdout.write(`  ${value ? '✓' : '⊘'} ${key.replace(/^has/, '').toLowerCase()}\n`)
}
appendRecord(ROOT, {
  ts: new Date().toISOString(),
  type: 'run-start',
  commit,
  flags: args,
  preflight: ctx,
})

// Core deps abort up front; optional deps (java, key, uv, cluster tools) demote their steps to
// honest skips inside buildPlan instead.
if (!ctx.hasDocker) {
  process.stderr.write('docker is required for the gauntlet (k6, Schemathesis, Testcontainers)\n')
  process.exit(2)
}

const plan = buildPlan(ctx, opts).filter(
  (s) => (only === undefined || s.phase === only) && (from === undefined || s.phase >= from),
)
const phases = [...new Set(plan.map((s) => s.phase))].sort((a, b) => a - b)

const records: StepRecord[] = []
const started = Date.now()
let aborted = false
for (const phase of phases) {
  process.stdout.write(`\n━━ Phase ${phase}: ${PHASE_TITLES[phase] ?? ''} ━━\n`)
  try {
    records.push(
      ...(await runPhase(
        ROOT,
        plan.filter((s) => s.phase === phase),
      )),
    )
  } catch (error) {
    if (!(error instanceof InfraAbort)) throw error
    process.stderr.write(`\n${error.message}\n`)
    aborted = true
    break
  }
}

const wallClockMs = Date.now() - started
const greens = records.filter((r) => r.status === 'green').length
const reds = records.filter((r) => r.status === 'red')
const skips = records.filter((r) => r.status === 'skipped').length
const observed = records.filter((r) => r.status === 'observed').length

process.stdout.write(`\n━━ Gauntlet summary ━━\n`)
process.stdout.write(
  `${greens} green, ${reds.length} red, ${skips} skipped, ${observed} observed — ${Math.round(wallClockMs / 60000)}min wall-clock\n`,
)
for (const red of reds) {
  process.stdout.write(`  ✗ phase ${red.phase} ${red.name} (exit ${red.exit}) — see ${red.log}\n`)
}
appendRecord(ROOT, {
  ts: new Date().toISOString(),
  type: 'run-end',
  wall_clock_ms: wallClockMs,
  green: greens,
  red: reds.length,
  skipped: skips,
  observed,
  aborted,
})

process.exit(aborted ? 2 : reds.length > 0 ? 1 : 0)
