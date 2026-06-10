import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  classifyTechnique,
  type DetectionToggle,
  PY_TECHNIQUE_CLASSIFIERS,
  TS_TECHNIQUE_CLASSIFIERS,
} from '@qaroom/contracts/detection-matrix'
import type { MatrixCell } from '@qaroom/contracts/detection-matrix-schema'

/**
 * Battery engine for the detection matrix (scripts/detection-matrix.ts). One sweep = run every
 * suite with a toggle's env injected, collect per-FILE verdicts, classify files into technique
 * groups. CRITICAL: sweeps spawn `pnpm exec vitest` per package directory — NEVER `pnpm test`
 * (turbo) — because turbo.json caches `test` outputs with no env inputs, so a toggled run could
 * replay a cached green and the whole matrix would be theater.
 */
export type FileStatus = 'passed' | 'failed' | 'skipped'

export interface SweepResult {
  /** repo-relative test file path → verdict ('skipped' = every case in the file skipped) */
  files: Map<string, FileStatus>
  duration_ms: number
}

const MATRIX_SEED = '12648430' // 0xc0ffee — pin the fast-check seed so baseline diffs are honest

/** Same package discovery as aggregate-test-results.ts, including its vitest-only filter. */
export function vitestPackageDirs(root: string): string[] {
  return globSync('{packages,services,tools}/*/package.json', { cwd: root })
    .sort()
    .map((rel) => resolve(root, dirname(rel)))
    .filter((dir) => {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
      return typeof pkg.scripts?.test === 'string' && pkg.scripts.test.includes('vitest')
    })
}

interface VitestFileReport {
  name?: string
  status?: string
}

export function runTsSweep(root: string, envPatch: Record<string, string>): SweepResult {
  const files = new Map<string, FileStatus>()
  const started = Date.now()
  for (const dir of vitestPackageDirs(root)) {
    const outRel = 'test-results/matrix-vitest.json'
    process.stdout.write(`    · vitest ${relative(root, dir)}\n`)
    spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outRel}`], {
      cwd: dir,
      env: { ...process.env, VITEST_SEED: MATRIX_SEED, ...envPatch },
      encoding: 'utf8',
    })
    const outPath = resolve(dir, outRel)
    if (!existsSync(outPath)) continue
    const report = JSON.parse(readFileSync(outPath, 'utf8'))
    for (const f of (report.testResults ?? []) as VitestFileReport[]) {
      if (!f.name) continue
      files.set(relative(root, f.name), f.status === 'failed' ? 'failed' : 'passed')
    }
  }
  return { files, duration_ms: Date.now() - started }
}

const MOD_DIR = 'services/moderator-agent'

/** classname "tests.test_selfcheck[.TestClass]" / "evals.redteam.test_x" → repo-relative path. */
const pyFile = (classname: string): string => {
  const parts = classname.split('.')
  const idx = parts.findIndex((p) => p.startsWith('test_'))
  return `${MOD_DIR}/${(idx >= 0 ? parts.slice(0, idx + 1) : parts).join('/')}.py`
}

export function runPySweep(
  root: string,
  envPatch: Record<string, string>,
  pytestArgs: string[] = ['-q'],
): SweepResult {
  const started = Date.now()
  const junitRel = 'test-results/matrix-pytest.xml'
  process.stdout.write(`    · pytest ${MOD_DIR} ${pytestArgs.join(' ')}\n`)
  spawnSync('uv', ['run', 'pytest', ...pytestArgs, `--junitxml=${junitRel}`], {
    cwd: resolve(root, MOD_DIR),
    env: { ...process.env, ...envPatch },
    encoding: 'utf8',
  })
  const files = new Map<string, FileStatus>()
  const junitPath = resolve(root, MOD_DIR, junitRel)
  if (!existsSync(junitPath)) return { files, duration_ms: Date.now() - started }
  const xml = readFileSync(junitPath, 'utf8')
  // Thin junit parse: per <testcase>, classname → file; any <failure>/<error> body → failed.
  // A file whose every case is <skipped> stays 'skipped' (key-gated groups must not read as green).
  const counts = new Map<string, { failed: number; skipped: number; total: number }>()
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const classname = /classname="([^"]*)"/.exec(m[1] ?? '')?.[1]
    if (!classname) continue
    const file = pyFile(classname)
    const entry = counts.get(file) ?? { failed: 0, skipped: 0, total: 0 }
    entry.total += 1
    const body = m[2] ?? ''
    if (/<(failure|error)\b/.test(body)) entry.failed += 1
    else if (/<skipped\b/.test(body)) entry.skipped += 1
    counts.set(file, entry)
  }
  for (const [file, c] of counts) {
    files.set(file, c.failed > 0 ? 'failed' : c.skipped === c.total ? 'skipped' : 'passed')
  }
  return { files, duration_ms: Date.now() - started }
}

/** Re-run ONE file with the toggle OFF; true = green (the toggle really caused the red). */
export function deflake(root: string, file: string): boolean {
  if (file.startsWith(MOD_DIR)) {
    const run = spawnSync('uv', ['run', 'pytest', '-q', file.slice(MOD_DIR.length + 1)], {
      cwd: resolve(root, MOD_DIR),
      encoding: 'utf8',
    })
    return run.status === 0
  }
  const dir = vitestPackageDirs(root).find((d) => resolve(root, file).startsWith(`${d}/`))
  if (!dir) return false
  const run = spawnSync('pnpm', ['exec', 'vitest', 'run', relative(dir, resolve(root, file))], {
    cwd: dir,
    env: { ...process.env, VITEST_SEED: MATRIX_SEED },
    encoding: 'utf8',
  })
  return run.status === 0
}

/** Technique groups a sweep is CAPABLE of verdicting (a green group = real 'missed' cell). */
export const TS_GROUPS = [
  'unit',
  'integration',
  'property',
  'mbt',
  'pact',
  'pact-oas-crosscheck',
  'reverse-conformance',
] as const
export const PY_GROUPS = ['py-unit', 'py-conformance', 'metamorphic'] as const

export interface CellInput {
  root: string
  toggle: DetectionToggle
  tier: MatrixCell['tier']
  sweep: SweepResult
  standingReds: Set<string>
  commit: string
  recordedAt: string
}

export function computeCells(input: CellInput): MatrixCell[] {
  const { root, toggle, tier, sweep, standingReds, commit, recordedAt } = input
  const isPy = toggle.component === 'moderator'
  const classifiers = isPy ? PY_TECHNIQUE_CLASSIFIERS : TS_TECHNIQUE_CLASSIFIERS
  const groups: readonly string[] = isPy ? PY_GROUPS : TS_GROUPS

  const newlyFailing = new Map<string, string[]>()
  for (const [file, status] of sweep.files) {
    if (status === 'failed' && !standingReds.has(file)) {
      const group = classifyTechnique(file, classifiers)
      newlyFailing.set(group, [...(newlyFailing.get(group) ?? []), file])
    }
  }

  return groups.map((technique) => {
    const failing = (newlyFailing.get(technique) ?? []).sort()
    const stable = failing.filter((f) => deflake(root, f))
    const unstable = failing.filter((f) => !stable.includes(f))
    const groupFiles = [...sweep.files.keys()].filter(
      (f) => classifyTechnique(f, classifiers) === technique,
    )
    const allSkipped =
      groupFiles.length > 0 && groupFiles.every((f) => sweep.files.get(f) === 'skipped')
    const status: MatrixCell['status'] = allSkipped
      ? 'skipped-cost'
      : stable.length > 0
        ? 'caught'
        : unstable.length > 0
          ? 'unstable'
          : 'missed'
    return {
      toggle: toggle.id,
      technique,
      tier,
      status,
      commit,
      recorded_at: recordedAt,
      duration_ms: sweep.duration_ms,
      evidence: {
        newly_failing: status === 'caught' ? stable : unstable,
        ...(allSkipped ? { justification: 'every case in this group skipped (key-gated)' } : {}),
      },
    }
  })
}
