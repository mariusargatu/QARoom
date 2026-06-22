import { describe, expect, it } from 'vitest'
import { rowsOf } from './types'

describe('rowsOf normalizes the cross-driver result shape', () => {
  it('returns a postgres-js row array unchanged', () => {
    expect(rowsOf<{ a: number }>([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('unwraps a pglite { rows } result', () => {
    expect(rowsOf<{ b: number }>({ rows: [{ b: 1 }] })).toEqual([{ b: 1 }])
  })

  it('returns an empty array for undefined', () => {
    expect(rowsOf(undefined)).toEqual([])
  })

  it('returns an empty array for null', () => {
    expect(rowsOf(null)).toEqual([])
  })

  it('returns an empty array for an object with neither shape', () => {
    expect(rowsOf({ count: 0 })).toEqual([])
  })
})
