import { spawn } from 'node:child_process'
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Step executor for the gauntlet (scripts/gauntlet.ts). Knows nothing about WHAT runs — it
 * spawns one step at a time, streams full output to a per-step log file, appends a JSONL record
 * per step (the incremental journal that makes `--from <phase>` resumability possible on a
 * multi-hour run), and enforces the three-class failure semantics:
 *
 *   infra    red aborts the run (nothing downstream is meaningful)
 *   gate     red is a FINDING — recorded, run continues, non-zero exit at the end
 *   observe  cannot be red — only data (an observation that gated would be theater)
 */
export type StepClass = 'infra' | 'gate' | 'observe'
export type StepStatus = 'green' | 'red' | 'observed' | 'skipped'

export interface GauntletStep {
  phase: number
  phaseTitle: string
  name: string
  class: StepClass
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  /** Steps sharing a lane run serially; distinct lanes within a phase run concurrently. */
  lane?: string
  timeoutMs?: number
  /** Pre-computed by buildPlan from preflight context; presence means "record as skipped". */
  skipReason?: string
}

export interface StepRecord {
  ts: string
  phase: number
  name: string
  class: StepClass
  status: StepStatus
  exit: number | null
  duration_ms: number
  reason?: string
  log?: string
}

export class InfraAbort extends Error {
  constructor(step: string) {
    super(`infra step "${step}" failed — aborting the run`)
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function gauntletDir(root: string): string {
  const dir = resolve(root, 'test-results/gauntlet')
  mkdirSync(resolve(dir, 'logs'), { recursive: true })
  return dir
}

export function appendRecord(root: string, record: StepRecord | Record<string, unknown>): void {
  appendFileSync(resolve(gauntletDir(root), 'steps.jsonl'), `${JSON.stringify(record)}\n`)
}

async function spawnStep(
  root: string,
  step: GauntletStep,
): Promise<{ exit: number | null; duration_ms: number; log: string }> {
  const logRel = `test-results/gauntlet/logs/${step.phase}-${slug(step.name)}.log`
  const logStream = createWriteStream(resolve(root, logRel))
  const started = Date.now()
  const child = spawn(step.cmd, step.args, {
    cwd: step.cwd ? resolve(root, step.cwd) : root,
    env: { ...process.env, ...step.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => {
    logStream.write(`\n[gauntlet] step timed out after ${timeoutMs}ms — SIGKILL\n`)
    child.kill('SIGKILL')
  }, timeoutMs)
  const exit = await new Promise<number | null>((resolveExit) => {
    child.on('close', (code) => resolveExit(code))
    child.on('error', (err) => {
      logStream.write(`\n[gauntlet] spawn error: ${String(err)}\n`)
      resolveExit(null)
    })
  })
  clearTimeout(timer)
  logStream.end()
  return { exit, duration_ms: Date.now() - started, log: logRel }
}

export async function runStep(root: string, step: GauntletStep): Promise<StepRecord> {
  const ts = new Date().toISOString()
  if (step.skipReason) {
    const record: StepRecord = {
      ts,
      phase: step.phase,
      name: step.name,
      class: step.class,
      status: 'skipped',
      exit: null,
      duration_ms: 0,
      reason: step.skipReason,
    }
    appendRecord(root, record)
    process.stdout.write(`  ⊘ ${step.name} — skipped (${step.skipReason})\n`)
    return record
  }
  process.stdout.write(`  ▶ ${step.name} [${step.class}] ${step.cmd} ${step.args.join(' ')}\n`)
  const { exit, duration_ms, log } = await spawnStep(root, step)
  const green = exit === 0
  const status: StepStatus = step.class === 'observe' ? 'observed' : green ? 'green' : 'red'
  const record: StepRecord = {
    ts,
    phase: step.phase,
    name: step.name,
    class: step.class,
    status,
    exit,
    duration_ms,
    log,
  }
  appendRecord(root, record)
  const mark = status === 'red' ? '✗' : status === 'observed' ? '◌' : '✓'
  process.stdout.write(
    `  ${mark} ${step.name} — ${status} (exit ${exit}, ${Math.round(duration_ms / 1000)}s, log: ${log})\n`,
  )
  if (step.class === 'infra' && !green) throw new InfraAbort(step.name)
  return record
}

/** Run one phase: lanes concurrently, steps within a lane serially. */
export async function runPhase(root: string, steps: GauntletStep[]): Promise<StepRecord[]> {
  const lanes = new Map<string, GauntletStep[]>()
  for (const step of steps) {
    const lane = step.lane ?? 'main'
    lanes.set(lane, [...(lanes.get(lane) ?? []), step])
  }
  const laneRuns = [...lanes.entries()].map(async ([, laneSteps]) => {
    const records: StepRecord[] = []
    for (const step of laneSteps) {
      records.push(await runStep(root, step))
    }
    return records
  })
  return (await Promise.all(laneRuns)).flat()
}
