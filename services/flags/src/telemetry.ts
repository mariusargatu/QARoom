import { startTelemetry } from '@qaroom/otel'

/**
 * OpenTelemetry preload (Milestone 3+). Loaded via `tsx --import ./src/telemetry.ts` BEFORE
 * `server.ts` so http/fastify instrumentation patches those modules before they import. The
 * SDK's `XStateTransitionSampler` keeps every `xstate.transition` span (Milestone 5). No-op
 * under `NODE_ENV=test`.
 */
const telemetry = startTelemetry({ serviceName: process.env.OTEL_SERVICE_NAME ?? 'flags' })
process.on('SIGTERM', () => {
  void telemetry.shutdown()
})
