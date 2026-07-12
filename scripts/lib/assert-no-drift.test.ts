import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoDrift } from './assert-no-drift'

// The extracted whole-file drift gate: committed artifact must byte-equal a fresh render, else exit 1.
// A bug here would let a stale render:adr-index / stress:render doc pass `pnpm verify` unnoticed.

let dir: string

// Make process.exit observable as a throw so the "fails the build" branch is assertable without
// tearing down the test runner.
const mockExit = () =>
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as never)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qaroom-drift-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('assertNoDrift', () => {
  it('returns without exiting when every committed file matches its fresh render', () => {
    const path = join(dir, 'artifact.md')
    writeFileSync(path, 'rendered content\n')
    const exit = mockExit()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(() =>
      assertNoDrift([{ path, rendered: 'rendered content\n' }], '`pnpm x` and commit'),
    ).not.toThrow()
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits (non-zero) and names the stale path when a committed file has drifted', () => {
    const path = join(dir, 'artifact.md')
    writeFileSync(path, 'stale content\n')
    mockExit()
    const errs: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown): boolean => {
      errs.push(String(chunk))
      return true
    }) as never)
    expect(() =>
      assertNoDrift([{ path, rendered: 'fresh content\n' }], '`pnpm x` and commit'),
    ).toThrow('process.exit called')
    expect(errs.join('')).toContain('is STALE')
  })

  it('fails loud (exits) when the committed file is absent', () => {
    const path = join(dir, 'never-written.md')
    mockExit()
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(() => assertNoDrift([{ path, rendered: 'anything\n' }], '`pnpm x`')).toThrow(
      'process.exit called',
    )
  })
})
