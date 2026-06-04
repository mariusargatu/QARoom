import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/** Single source for the donations-service OpenAPI document (build script + round-trip test). */
export function donationsOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom donations-service',
      version: '0.0.0',
      description:
        'Per-community donations, gated by the donations feature flag. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8084', description: 'local docker-compose' }],
  )
}
