import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
// Importing the schema modules registers their `.meta({ id })` schemas in the global
// registry, which is what the registry walk reads.
import './errors'
import './post'
import {
  emitRegistrySchemas,
  findRefs,
  reachableSchemas,
  SCHEMA_REF_PREFIX,
  stringifyDoc,
} from './registry-schema'

describe('emitRegistrySchemas', () => {
  it('emits every registered schema by its meta id', () => {
    const schemas = emitRegistrySchemas()
    expect(schemas.ProblemDetails).toBeDefined()
    expect(schemas.Post).toBeDefined()
  })

  it('strips the $id so the ref alone carries schema identity', () => {
    const schemas = emitRegistrySchemas()
    expect(schemas.ProblemDetails?.$id).toBeUndefined()
  })
})

describe('findRefs', () => {
  it('collects component refs from a nested object', () => {
    const node = {
      a: { $ref: `${SCHEMA_REF_PREFIX}Post` },
      b: { c: { $ref: `${SCHEMA_REF_PREFIX}AsOf` } },
    }
    expect(findRefs(node).sort()).toEqual(['AsOf', 'Post'])
  })

  it('collects component refs from arrays', () => {
    const node = [{ $ref: `${SCHEMA_REF_PREFIX}Post` }, { $ref: `${SCHEMA_REF_PREFIX}AsOf` }]
    expect(findRefs(node).sort()).toEqual(['AsOf', 'Post'])
  })

  it('ignores refs that are not component-schema refs', () => {
    expect(findRefs({ $ref: 'https://example.com/external' })).toEqual([])
  })

  it('returns no refs for primitive leaves', () => {
    expect(findRefs('a-string')).toEqual([])
    expect(findRefs(42)).toEqual([])
    expect(findRefs(null)).toEqual([])
  })
})

describe('reachableSchemas', () => {
  it('returns only the transitive ref closure of the root ids', () => {
    const reachable = reachableSchemas(['Feed'])
    // Feed -> Post -> branded ids + AsOf; the closure must include Post.
    expect(reachable.Feed).toBeDefined()
    expect(reachable.Post).toBeDefined()
    // A sibling schema not referenced by Feed must not leak in.
    expect(reachable.ProblemDetails).toBeUndefined()
  })

  it('emits the reachable ids in sorted order', () => {
    const keys = Object.keys(reachableSchemas(['Feed']))
    expect(keys).toEqual([...keys].sort())
  })

  it('returns an empty map for no roots', () => {
    expect(reachableSchemas([])).toEqual({})
  })

  it('ignores a root id that is not registered', () => {
    expect(reachableSchemas(['NoSuchSchema'])).toEqual({})
  })
})

describe('stringifyDoc', () => {
  it('round-trips a document through deterministic YAML', () => {
    const doc = { openapi: '3.0.3', paths: {} }
    expect(parse(stringifyDoc(doc))).toEqual(doc)
  })

  it('quotes a YAML-1.1-ambiguous Off so it round-trips as a string, not false', () => {
    const yaml = stringifyDoc({ state: 'Off' })
    expect(yaml).toContain('"Off"')
  })

  it('preserves declared key order rather than sorting', () => {
    const yaml = stringifyDoc({ b: 1, a: 2 })
    expect(yaml.indexOf('b:')).toBeLessThan(yaml.indexOf('a:'))
  })
})
