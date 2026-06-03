import { describe, expect, it } from 'vitest'
import { UlidIdGenerator } from './ulid-id-generator'

describe('UlidIdGenerator', () => {
  it('prefixes ids with the requested prefix and a 26-char ULID body', () => {
    const id = new UlidIdGenerator().next('post')
    expect(id.startsWith('post_')).toBe(true)
    expect(id.slice('post_'.length)).toHaveLength(26)
  })

  it('returns a distinct id on each successive call', () => {
    const gen = new UlidIdGenerator()
    expect(gen.next('post')).not.toBe(gen.next('post'))
  })
})
