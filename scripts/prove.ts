import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { gateLine, loadSummary, resolveEvidence, type Summary } from './lib/claim-evidence'
import { CLAIMS, type Claim, claimById } from './lib/manifests/claims'

/**
 * `pnpm prove <id> [--break]`: the falsifiability machine (ADR: demo-as-tested-surface).
 *
 *   pnpm prove <id>          read live evidence from summary.json and print the claim card (offline).
 *   pnpm prove <id> --break  set the claim's deliberate-bug toggle and re-run its gate: the gate
 *                            MUST go red (the claim is falsifiable). A gate that stays green is
 *                            THEATER and exits non-zero.
 *   pnpm prove               list every claim with its live status.
 *
 * The CLI owns no test logic: it dispatches to the existing gate tests + reads the frozen
 * summary.json. Every printed number carries its provenance; nothing is hand-typed.
 */

const ROOT = process.cwd()

// Tiny ANSI helper: honors NO_COLOR + non-TTY (CI) by degrading to plain text.
const useColor = !process.env.NO_COLOR && process.stdout.isTTY
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const c = {
  green: (s: string) => paint('32', s),
  red: (s: string) => paint('31;1', s),
  amber: (s: string) => paint('33', s),
  dim: (s: string) => paint('2', s),
  bold: (s: string) => paint('1', s),
  cyan: (s: string) => paint('36', s),
}

function printCard(claim: Claim, summary: Summary | null): void {
  const ev = resolveEvidence(claim, summary)
  const badge = ev.stale ? c.amber('● STALE') : c.green('● VERIFIED')
  process.stdout.write(
    `\n${badge}  ${c.bold(claim.id)}  ${c.dim(`[${claim.boundary} · ${claim.tier}]`)}\n`,
  )
  process.stdout.write(`  ${claim.claim}\n\n`)
  process.stdout.write(`  ${c.dim('technique  ')}${claim.technique}\n`)
  process.stdout.write(`  ${c.dim('breaks when')}  ${c.cyan(claim.toggle)}\n`)
  process.stdout.write(`  ${c.dim('caught by  ')}  ${gateLine(claim)}\n`)
  const evText = ev.value === null ? c.amber('unresolved') : `${claim.evidence.field}=${ev.value}`
  process.stdout.write(`  ${c.dim('evidence   ')}  ${evText}  ${c.dim(`← ${ev.provenance}`)}\n\n`)
  process.stdout.write(`  ${c.dim('▶ falsify it:')}  pnpm prove ${claim.id} --break\n`)
}

function runBreak(claim: Claim): number {
  const summary = loadSummary()
  const ev = resolveEvidence(claim, summary)
  process.stdout.write(`\n${c.bold(claim.id)}: arming ${c.cyan(`${claim.toggle}=1`)} …\n`)
  process.stdout.write(
    `  baseline: ${ev.value === null ? c.amber('unverified') : c.green(`GREEN · ${claim.evidence.runner} ${claim.evidence.field}=${ev.value}`)} ${c.dim(`(${ev.provenance})`)}\n`,
  )
  process.stdout.write(`  running the gate WITH the bug toggle set …\n`)
  const run = spawnSync(claim.gate.cmd, claim.gate.args, {
    cwd: claim.gate.cwd ? resolve(ROOT, claim.gate.cwd) : ROOT,
    env: { ...process.env, [claim.toggle]: '1' },
    encoding: 'utf8',
  })
  // A spawn FAILURE (status === null: ENOENT for a missing `uv`/`pnpm`, a signal kill) is NOT the
  // gate going red — the gate never ran. Treating it as red is the exact false-green this machine
  // exists to catch (a no-uv box would report the moderator teeth "falsifiable" without running
  // pytest). Surface it loudly and exit non-zero so the missing prerequisite cannot read as a pass.
  if (run.status === null) {
    process.stdout.write(
      `  ${c.red('✗ GATE DID NOT RUN')}: spawning \`${claim.gate.cmd}\` failed (${run.error?.message ?? 'no exit status'}).\n` +
        `  ${c.dim('install the gate prerequisite and re-run; a missing binary is NOT a falsified claim.')}\n`,
    )
    return 2
  }
  const red = run.status !== 0 // a non-zero gate = the guarantee test FAILED = the bug was caught
  // …BUT a live/k6 gate can also exit non-zero because the load driver could not REACH the target at
  // all (a port-forward that binds loopback while k6 runs in docker; a pod mid-rollout). That is a
  // TRANSPORT failure, not the guarantee being caught: the gate never exercised the SLO/invariant, so
  // reporting it as "falsifiable" is a false RED (the exact mislabel the 2026-07-10 audit found on the
  // outbox live claim, where k6 got `connection refused` yet the run read as caught). Classify it as
  // status 2 — "gate could not run" — the same honest bucket as a missing `uv`, so claims-verify never
  // banks a live claim's teeth on a run that never connected. These markers do not appear when an
  // in-process gate legitimately reds (a vitest assertion failure carries none of them).
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const TRANSPORT_FAILURE =
    /connection refused|dial tcp|ECONNREFUSED|EHOSTUNREACH|no route to host|could not resolve host|context deadline exceeded|i\/o timeout/i
  if (red && TRANSPORT_FAILURE.test(output)) {
    process.stdout.write(
      `  ${c.amber('✗ GATE COULD NOT RUN')}: the target was unreachable (transport failure), not a caught guarantee failure.\n` +
        `  ${c.dim('a connection error is not a falsification — the gate never exercised the guarantee. Re-run against a reachable, primed target (the gauntlet cluster lane).')}\n`,
    )
    return 2
  }
  if (red) {
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`
      .split('\n')
      .filter((l) => /fail|expect|assert|error|✗|×|FAILED/i.test(l))
      .slice(-4)
      .map((l) => `    ${c.dim(l.trim())}`)
      .join('\n')
    process.stdout.write(
      `  ${c.red('✗ GATE RED')}: the guarantee test FAILED, the toggle was caught.\n`,
    )
    if (tail) process.stdout.write(`${tail}\n`)
    process.stdout.write(
      `  ${c.dim('reverted (env not persisted).')} the gate is real: the claim is falsifiable.\n`,
    )
    return 0
  }
  process.stdout.write(
    `  ${c.amber('⚠ GATE STILL GREEN')}: the toggle did NOT break the gate. This claim is THEATER.\n`,
  )
  return 1
}

function list(): void {
  const summary = loadSummary()
  process.stdout.write(
    `\n${c.bold('QARoom: falsifiable claims')}  ${c.dim('(pnpm prove <id> [--break])')}\n`,
  )
  for (const claim of CLAIMS) {
    const ev = resolveEvidence(claim, summary)
    const dot = ev.stale ? c.amber('●') : c.green('●')
    const val = ev.value === null ? c.amber(': ') : `${claim.evidence.field}=${ev.value}`
    process.stdout.write(
      `  ${dot} ${claim.id.padEnd(24)} ${c.dim(claim.boundary.padEnd(15))} ${val.padEnd(12)} ${c.dim(`breaks: ${claim.toggle}`)}\n`,
    )
  }
  process.stdout.write('\n')
}

function matrix(): void {
  const summary = loadSummary()
  process.stdout.write(
    `\n${c.bold('QARoom: falsifiable-claim matrix')}  ${c.dim('boundary × claim')}\n\n`,
  )
  const byBoundary = new Map<string, Claim[]>()
  for (const claim of CLAIMS) {
    byBoundary.set(claim.boundary, [...(byBoundary.get(claim.boundary) ?? []), claim])
  }
  for (const [boundary, claims] of [...byBoundary].sort()) {
    process.stdout.write(`  ${c.bold(boundary)}\n`)
    for (const claim of claims) {
      const ev = resolveEvidence(claim, summary)
      const dot = ev.stale ? c.amber('●') : c.green('●')
      const val =
        ev.value === null ? c.amber('stale') : c.green(`${claim.evidence.field}=${ev.value}`)
      process.stdout.write(
        `    ${dot} ${claim.id.padEnd(24)} ${val.padEnd(16)} ${c.dim(`↯ ${claim.toggle}`)}\n`,
      )
    }
  }
  process.stdout.write('\n')
}

function emitJson(): void {
  const summary = loadSummary()
  const claims = CLAIMS.map((claim) => {
    const ev = resolveEvidence(claim, summary)
    return {
      id: claim.id,
      claim: claim.claim,
      boundary: claim.boundary,
      technique: claim.technique,
      toggle: claim.toggle,
      gate: gateLine(claim),
      evidence: { field: claim.evidence.field, value: ev.value, provenance: ev.provenance },
      status: ev.stale ? 'stale' : 'verified',
      prove: `pnpm prove ${claim.id}`,
      break: `pnpm prove ${claim.id} --break`,
    }
  })
  process.stdout.write(`${JSON.stringify({ claims }, null, 2)}\n`)
}

function main(): void {
  const args = process.argv.slice(2)
  const id = args.find((a) => !a.startsWith('--'))
  const wantBreak = args.includes('--break')

  if (args.includes('--json')) {
    emitJson()
    return
  }
  if (args.includes('--matrix')) {
    matrix()
    return
  }
  if (!id) {
    list()
    return
  }
  const claim = claimById(id)
  if (!claim) {
    process.stderr.write(`unknown claim '${id}'. known: ${CLAIMS.map((cl) => cl.id).join(', ')}\n`)
    process.exit(2)
  }
  if (wantBreak) {
    process.exit(runBreak(claim))
  }
  printCard(claim, loadSummary())
}

main()
