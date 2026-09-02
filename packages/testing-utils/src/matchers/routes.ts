import type { OasOperation } from '@qaroom/contracts'

/** The subset of Fastify this matcher needs — kept structural so testing-utils needs no fastify dep. */
export interface RoutableApp {
  hasRoute(opts: { method: string; url: string }): boolean
}

/** OAS templating (`/posts/{postId}`) → Fastify params (`/posts/:postId`). */
function toFastifyUrl(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

/**
 * Assert every operation the service DECLARES is actually served.
 *
 * The gap this closes: `expectCapabilitiesCover` compares `/system/capabilities` against the
 * operation registry, but BOTH are generated from that registry — it is the pipeline checking
 * itself, and it cannot notice that no handler was ever registered. Nor can the drift gates: an
 * operation added to the registry regenerates `openapi.yaml` (so `openapi:verify` passes) and
 * regenerates capabilities (so the cover check passes) while every request to it 404s. Only
 * Schemathesis would catch it, live, in a Docker lane.
 *
 * `hasRoute` asks the router itself, so this is the one assertion in the chain whose answer comes
 * from the running app rather than from the registry the spec was generated from.
 */
export function expectEveryOperationRouted(
  app: RoutableApp,
  operations: readonly OasOperation[],
): void {
  const missing = operations
    .filter((op) => !app.hasRoute({ method: op.method.toUpperCase(), url: toFastifyUrl(op.path) }))
    .map((op) => `${op.method.toUpperCase()} ${op.path} (${op.operationId})`)

  if (missing.length > 0) {
    throw new Error(
      `declared in the operation registry but NOT registered on the app (every request would 404):\n  ${missing.join('\n  ')}`,
    )
  }
  // A registry that has gone empty would make the check above vacuously true.
  if (operations.length === 0) {
    throw new Error(
      'operation registry is empty — the routed check would pass having asserted nothing',
    )
  }
}
