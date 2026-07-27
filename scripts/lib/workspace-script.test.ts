import { describe, expect, it } from 'vitest'
import {
  assertServiceListCoversWorkspace,
  noOpReason,
  runWorkspaceScript,
  servicesDeclaringScript,
} from './workspace-script'

/**
 * The hole this guards, measured on pnpm 10.17.1: `pnpm --filter <pkg> <script>` exits **0** both
 * when the filter matches nothing AND when no selected package has the script. The drift gates
 * (`openapi-verify.ts`, `asyncapi-verify.ts`) read-before / shell-out / read-after, so a silent
 * no-op reads as "the committed spec matches Zod" and prints a green checkmark having regenerated
 * nothing — a service silently drops out of the gate on a package rename while CI reports it
 * verified.
 */
describe('noOpReason names the pnpm output that means nothing ran', () => {
  it('flags a filter that matched no project', () => {
    expect(noOpReason('No projects matched the filters in "/repo"')).toBe(
      'the --filter matched no workspace package',
    )
  })

  it('flags a matched package that has no such script', () => {
    expect(noOpReason('None of the selected packages has a "openapi:generate" script')).toBe(
      'the matched package(s) declare no such script',
    )
  })

  it('returns null for output from a generator that really ran', () => {
    expect(noOpReason('> tsx src/openapi-build.ts\nwrote /repo/services/flags/openapi.yaml')).toBe(
      null,
    )
  })
})

describe('servicesDeclaringScript reads the workspace, not a hand-list', () => {
  it('finds every service whose package.json declares openapi:generate', () => {
    // Seven, not the six `openapi-verify.ts` gates: moderator-agent declares the script too (it
    // generates via `uv`, and its drift is checked in the nightly Python lane instead). Derived
    // from disk, so a rename shows up here as a set difference, never as a silently-skipped service.
    expect(servicesDeclaringScript('openapi:generate').sort()).toEqual([
      'content',
      'donations',
      'flags',
      'gateway',
      'identity',
      'moderator-agent',
      'webhooks',
    ])
  })

  it('excludes services that declare no such script', () => {
    expect(servicesDeclaringScript('openapi:generate')).not.toContain('qaroom-mcp')
  })
})

describe('assertServiceListCoversWorkspace pins a gate list to the workspace', () => {
  it('accepts the list when every declaring service is gated or explicitly exempt', () => {
    expect(() =>
      assertServiceListCoversWorkspace(
        ['content', 'identity', 'gateway', 'flags', 'donations', 'webhooks'],
        'openapi:generate',
        { 'moderator-agent': 'Python service; drift checked by pytest in the nightly lane' },
      ),
    ).not.toThrow()
  })

  it('rejects a service that declares the generator but is neither gated nor exempt', () => {
    expect(() => assertServiceListCoversWorkspace(['content'], 'openapi:generate', {})).toThrow(
      /ungated/,
    )
  })

  it('rejects a gated service that no longer declares the generator — the rename case', () => {
    expect(() =>
      assertServiceListCoversWorkspace(['content', 'renamed-away'], 'openapi:generate', {}),
    ).toThrow(/no longer declaring/)
  })
})

describe('runWorkspaceScript converts a silent pnpm no-op into a throw', () => {
  it('throws when the filter matches no package, where pnpm alone would exit 0', () => {
    expect(() => runWorkspaceScript('@qaroom/does-not-exist', 'openapi:generate')).toThrow(
      /matched no workspace package/,
    )
  })

  it('throws when the matched package declares no such script', () => {
    expect(() => runWorkspaceScript('@qaroom/determinism', 'openapi:generate')).toThrow(
      /declare no such script/,
    )
  })
})
