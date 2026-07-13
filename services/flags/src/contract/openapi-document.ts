import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/** Single source for the flags-service OpenAPI document. The build script and the */
/** round-trip test both call this, so they cannot drift. */
export function flagsOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom flags-service',
      version: '0.0.0',
      description:
        'Per-community feature-flag resolution and rollout. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8083', description: 'local docker-compose' }],
  )
}
