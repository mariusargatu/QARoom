import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/** Single source for the content-service OpenAPI document params. The build */
/** script and the round-trip test both call this, so they cannot drift. */
export function contentOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom content-service',
      version: '0.0.0',
      description: 'Posts and votes within communities. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8081', description: 'local docker-compose' }],
  )
}
