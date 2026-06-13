import type { McpResourceDef } from '../schema/mcp'

/**
 * Read resources (ADR-0006): each service's `/system/state`, the gateway's
 * `/system/limits`, and the frozen `test-results/summary.json`. Each is validated
 * against its published Zod / frozen schema when read.
 */
export type ResourceKind = 'system-state' | 'system-limits' | 'test-results'

export interface ResourceEntry {
  def: McpResourceDef
  kind: ResourceKind
  /** Backing service + GET path for proxied reads. Omitted for non-proxy resources (test-results). */
  service?: string
  path?: string
}

const ENTRIES: readonly ResourceEntry[] = [
  {
    def: {
      uri: 'qaroom://content/system/state',
      name: 'content system state',
      description: 'Observable state of content-service (post/vote counts) with an as_of envelope.',
      mime_type: 'application/json',
    },
    kind: 'system-state',
    service: 'content',
    path: '/system/state',
  },
  {
    def: {
      uri: 'qaroom://gateway/system/state',
      name: 'gateway system state',
      description: 'Observable state of the gateway with an as_of envelope.',
      mime_type: 'application/json',
    },
    kind: 'system-state',
    service: 'gateway',
    path: '/system/state',
  },
  {
    def: {
      uri: 'qaroom://gateway/system/limits',
      name: 'gateway rate-limit usage',
      description: "The calling principal's current rate-limit usage and time to full refill.",
      mime_type: 'application/json',
    },
    kind: 'system-limits',
    service: 'gateway',
    path: '/system/limits',
  },
  {
    def: {
      uri: 'qaroom://test-results/summary',
      name: 'test-results summary',
      description: 'The frozen test-results/summary.json envelope, validated against its schema.',
      mime_type: 'application/json',
    },
    kind: 'test-results',
  },
]

export function buildResourceEntries(): readonly ResourceEntry[] {
  return ENTRIES
}
