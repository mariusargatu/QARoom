import { startTelemetry } from './start-telemetry'

/**
 * OpenTelemetry preload shared by every service's `src/telemetry.ts`, which is loaded via
 * `tsx --import ./src/telemetry.ts` BEFORE `server.ts` so http/fastify instrumentation patches
 * those modules before they import. Reads `OTEL_SERVICE_NAME`, falling back to `defaultServiceName`.
 * The SDK's `XStateTransitionSampler` keeps every `xstate.transition` span (Milestone 5). No-op
 * under `NODE_ENV=test` (handled by `startTelemetry`). Installs a SIGTERM flush of the exporter.
 *
 * Lives in @qaroom/otel (not @qaroom/service-kit) on purpose: the preload must not transitively
 * import fastify before instrumentation is installed, and otel is the only package telemetry.ts imports.
 */
export function startServicePreload(defaultServiceName: string): void {
  const telemetry = startTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME ?? defaultServiceName,
  })
  process.on('SIGTERM', () => {
    void telemetry.shutdown()
  })
}
