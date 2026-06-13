import { describe, expect, it } from 'vitest'
import {
  baseManifest,
  manifestWithAddedRequired,
  manifestWithBumpedProtocol,
  manifestWithChangedResourceMime,
  manifestWithChangedToolMethod,
  manifestWithChangedToolPath,
  manifestWithChangedType,
  manifestWithExtraTool,
  manifestWithoutFirstResource,
  manifestWithoutFirstTool,
  manifestWithRemovedInputProperty,
} from '../test-support/manifest-mutations'
import { breakingManifestChanges, classifyManifestChanges } from './diff'

describe('the manifest breaking-change classifier', () => {
  it('reports no changes between a manifest and itself', () => {
    expect(classifyManifestChanges(baseManifest, baseManifest)).toEqual([])
  })

  it('flags a removed tool as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithoutFirstTool()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('tool-removed')
  })

  it('treats an added tool as a non-breaking widening', () => {
    expect(breakingManifestChanges(baseManifest, manifestWithExtraTool())).toEqual([])
  })

  it('flags a newly required input as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithAddedRequired()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('required-input-added')
  })

  it('flags an input type change as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithChangedType()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('input-type-changed')
  })

  it('flags a removed input property as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithRemovedInputProperty()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('input-property-removed')
  })

  it('flags a changed tool path as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithChangedToolPath()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('tool-path-changed')
  })

  it('flags a changed tool method as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithChangedToolMethod()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('tool-method-changed')
  })

  it('flags a removed resource as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithoutFirstResource()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('resource-removed')
  })

  it('flags a changed resource mime type as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithChangedResourceMime()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('resource-mime-type-changed')
  })

  it('flags a protocol-version bump as a breaking change', () => {
    const kinds = breakingManifestChanges(baseManifest, manifestWithBumpedProtocol()).map(
      (c) => c.kind,
    )
    expect(kinds).toContain('protocol-version-changed')
  })
})
