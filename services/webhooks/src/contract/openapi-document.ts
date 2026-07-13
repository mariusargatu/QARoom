import { buildServiceOpenApiYaml } from '@qaroom/service-kit'
import { OPERATIONS } from './operations'

/** Single source for the webhooks-service OpenAPI document (build script + round-trip test). */
export function webhooksOpenApiYaml(): string {
  return buildServiceOpenApiYaml(
    {
      title: 'QARoom webhooks-service',
      version: '0.0.0',
      description:
        'Outbound webhook subscriptions and delivery of QARoom events to external subscribers (at-least-once, retry/backoff, HMAC). Generated from Zod — do not edit by hand.',
    },
    OPERATIONS,
    [{ url: 'http://localhost:8087', description: 'local docker-compose' }],
  )
}
