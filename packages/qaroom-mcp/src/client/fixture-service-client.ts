import type { ServiceClient, ServiceResponse } from '../deps'

/**
 * A deterministic ServiceClient for unit / property / golden tests (and demos). Routes
 * are matched by service + path; the canned response is byte-stable, so a seeded tool
 * call yields a reproducible transcript without booting a database.
 */
export interface FixtureRoute {
  service: string
  path: string | RegExp
  response: ServiceResponse
}

export function jsonResponse(status: number, body: unknown): ServiceResponse {
  return { status, contentType: 'application/json', body }
}

export function problemResponse(status: number, body: unknown): ServiceResponse {
  return { status, contentType: 'application/problem+json', body }
}

function matches(route: FixtureRoute, service: string, path: string): boolean {
  if (route.service !== service) return false
  return typeof route.path === 'string' ? route.path === path : route.path.test(path)
}

export function fixtureServiceClient(
  routes: readonly FixtureRoute[],
  fallback?: ServiceResponse,
): ServiceClient {
  return {
    async get(service, path) {
      const route = routes.find((candidate) => matches(candidate, service, path))
      if (route) return route.response
      if (fallback) return fallback
      throw new Error(`fixture service client: no route for ${service} ${path}`)
    },
  }
}
