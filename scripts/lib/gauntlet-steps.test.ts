import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { type GauntletStep, gauntletDir, runStep } from './gauntlet-steps'

// Regression test for the wedge: a step's direct child is SIGKILLed on timeout, but a hung GRANDCHILD
// that inherited the stdout pipe (e.g. a pact provider server that never closes) used to survive and
// hold the pipe open, so 'close' never fired and the whole multi-hour run hung forever. The fix makes
// the child a process-group leader (`detached: true`) and kills the WHOLE group on timeout.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qaroom-gauntlet-step-'))
  gauntletDir(dir) // create test-results/gauntlet/logs, as the real run does at startup
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// The direct child backgrounds a grandchild that records its own pid (which becomes the `sleep` pid
// via `exec`) and inherits the stdout pipe, then `wait`s — exactly the shape that used to wedge.
it('reaps the whole process group on timeout, killing a hung grandchild that holds the stdout pipe', async () => {
  const pidFile = join(dir, 'grandchild.pid')
  const step: GauntletStep = {
    phase: 99,
    phaseTitle: 'test',
    name: 'wedge-probe',
    class: 'gate',
    cmd: 'sh',
    args: ['-c', `sh -c 'echo $$ > "${pidFile}"; exec sleep 30' & wait`],
    timeoutMs: 800,
  }

  const record = await runStep(dir, step)

  const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim())
  // Group-kill reaped the grandchild: probing a dead pid with signal 0 throws (ESRCH). If only the
  // direct child had been killed, the grandchild would still be alive and this would NOT throw.
  expect(() => process.kill(grandchildPid, 0)).toThrow()
  // And it returned via the fast group-kill path, not the 5s force-resolve fallback (which only fires
  // when a process escapes the group) — proof the group kill, not the safety net, did the work.
  expect(record.duration_ms).toBeLessThan(4_000)
  expect(record.status).toBe('red')
}, 15_000)
