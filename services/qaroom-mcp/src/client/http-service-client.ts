import type { ServiceClient } from '../deps'

/** Map of service name → base URL (e.g. `{ gateway: 'http://qaroom.localhost' }`). */
export type ServiceBaseUrls = Record<string, string>

async function parseBody(response: Response, contentType: string): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/** Production ServiceClient: proxies reads to the live services over HTTP. */
export function httpServiceClient(baseUrls: ServiceBaseUrls): ServiceClient {
  return {
    async get(service, path, query) {
      const base = baseUrls[service]
      if (base === undefined) {
        throw new Error(`no base URL configured for service "${service}"`)
      }
      const url = new URL(path, base)
      if (query) {
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
      }
      const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } })
      const contentType = response.headers.get('content-type') ?? 'application/json'
      return { status: response.status, contentType, body: await parseBody(response, contentType) }
    },
  }
}
