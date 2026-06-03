import { PostId } from '@qaroom/contracts'
import { describe, expect, it } from 'vitest'
import { SeededIdGenerator } from './seeded-id-generator'

describe('SeededIdGenerator', () => {
  it('yields the same id sequence for the same seed', () => {
    const a = new SeededIdGenerator(7)
    const b = new SeededIdGenerator(7)
    expect([a.next('post'), a.next('post')]).toEqual([b.next('post'), b.next('post')])
  })

  it('yields distinct, monotonically increasing ids within one generator', () => {
    const gen = new SeededIdGenerator(1)
    expect(gen.next('post')).not.toBe(gen.next('post'))
  })

  it('produces ids that satisfy the branded id parser', () => {
    const gen = new SeededIdGenerator(1)
    expect(() => PostId.parse(gen.next('post'))).not.toThrow()
  })
})
