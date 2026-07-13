import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from '../operations/operations'

/** Single source for the gateway OpenAPI document params (build script + round-trip test). */
export function gatewayOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom gateway',
      version: '0.0.0',
      description:
        'External API gateway fronting content-, donations-, flags-, webhooks-, identity-service and the moderator-agent. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8080', description: 'local' }],
  )
}
