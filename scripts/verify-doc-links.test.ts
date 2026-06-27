import { describe, expect, it } from 'vitest'
import { extractTargets, findDeadLinks, localPath } from './verify-doc-links'

describe('extractTargets', () => {
  it('pulls inline + image link targets', () => {
    const md = 'see [arch](ARCHITECTURE.md) and ![hero](docs/assets/x.svg)'
    expect(extractTargets(md)).toEqual(['ARCHITECTURE.md', 'docs/assets/x.svg'])
  })

  it('ignores links inside fenced code blocks', () => {
    const md = 'real [a](a.md)\n```\nexample [b](b.md)\n```\n'
    expect(extractTargets(md)).toEqual(['a.md'])
  })
})

describe('localPath', () => {
  it('returns the on-disk path, dropping fragment and title', () => {
    expect(localPath('docs/x.md#section')).toBe('docs/x.md')
    expect(localPath('docs/x.md "the title"')).toBe('docs/x.md')
    expect(localPath('a%20b.md')).toBe('a b.md')
  })

  it('skips external, protocol-relative, and pure-anchor links', () => {
    expect(localPath('https://example.com')).toBeNull()
    expect(localPath('mailto:a@b.com')).toBeNull()
    expect(localPath('//cdn.example.com/x')).toBeNull()
    expect(localPath('#heading')).toBeNull()
  })
})

describe('findDeadLinks', () => {
  const read = (f: string): string =>
    f === 'README.md' ? 'live [a](ok.md) dead [b](gone.md) ext [c](https://x.com)' : ''
  const exists = (absPath: string): boolean => absPath.endsWith('/ok.md')

  it('flags only the unresolved relative link', () => {
    expect(findDeadLinks(['README.md'], read, exists)).toEqual([
      { file: 'README.md', target: 'gone.md' },
    ])
  })

  it('is clean when every relative target resolves', () => {
    const allOk = (): boolean => true
    expect(findDeadLinks(['README.md'], read, allOk)).toEqual([])
  })
})
