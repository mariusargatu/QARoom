import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/** Single source for the identity-service OpenAPI document params. The build script and */
/** the round-trip test both call this, so generated and committed YAML cannot drift. */
export function identityOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom identity-service',
      version: '0.0.0',
      description:
        'Users, communities-as-tenants, memberships, sessions, and JWT/JWKS. Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8082', description: 'local docker-compose' }],
  )
}
