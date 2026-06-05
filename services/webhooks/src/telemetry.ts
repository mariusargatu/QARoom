import { startTelemetry } from '@qaroom/otel'

/**
 * OpenTelemetry preload. Loaded via `tsx --import ./src/telemetry.ts` BEFORE `server.ts` so
 * http/fastify instrumentation patches those modules before they import. No-op under
 * `NODE_ENV=test`.
 */
const telemetry = startTelemetry({ serviceName: process.env.OTEL_SERVICE_NAME ?? 'webhooks' })
process.on('SIGTERM', () => {
  void telemetry.shutdown()
})
