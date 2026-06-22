import { describe, expect, it } from 'vitest'
import { composeMigrations, type Migration } from './migration'

/** A no-op transaction handle; the migrations only record their own invocation order. */
type Tx = Record<string, never>

function recordingMigration(name: string, log: string[]): Migration<Tx> {
  return {
    name,
    async up() {
      log.push(`up:${name}`)
    },
    async down() {
      log.push(`down:${name}`)
    },
  }
}

describe('composeMigrations', () => {
  it('runs up in declared order', async () => {
    const log: string[] = []
    const composed = composeMigrations([
      recordingMigration('a', log),
      recordingMigration('b', log),
      recordingMigration('c', log),
    ])
    await composed.up({})
    expect(log).toEqual(['up:a', 'up:b', 'up:c'])
  })

  it('runs down in reverse (LIFO) order so each step unwinds against its expected state', async () => {
    const log: string[] = []
    const composed = composeMigrations([
      recordingMigration('a', log),
      recordingMigration('b', log),
      recordingMigration('c', log),
    ])
    await composed.down({})
    expect(log).toEqual(['down:c', 'down:b', 'down:a'])
  })

  it('composes an empty list into up and down no-ops that resolve to undefined', async () => {
    const composed = composeMigrations<Tx>([])
    await expect(composed.up({})).resolves.toBeUndefined()
    await expect(composed.down({})).resolves.toBeUndefined()
  })
})
