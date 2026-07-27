import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

/**
 * The payment-provider contract exists in TWO hand-maintained copies:
 *   - `deploy/observability/microcks.yaml`, inlined in a ConfigMap — what Microcks actually serves
 *   - `services/donations/payment-provider.openapi.yaml` — what every doc, ADR and reader points at
 * Nothing compared them, and they had already diverged (`additionalProperties`, `servers`, and
 * three description keys). Today that divergence is behaviourally inert because the mock does not
 * validate request bodies, but the two are supposed to be the same contract, and the moment one is
 * used as an oracle they disagree silently.
 *
 * Microcks derives the mock URL from `info.title` + `info.version`, so `PAYMENT_PROVIDER_BASE_URL`
 * in `deploy/donations/values.yaml` is coupled to those two fields by string equality across two
 * files with nothing checking it. Rename the title and every charge 404s into a donations 502,
 * while `pnpm verify`, `pnpm test` and kubeconform all stay green.
 *
 * MEASURED against microcks-uber 1.11.0 (the pinned image), uploading the real spec:
 *   /rest/QARoom%20Payment%20Provider%20(mock)/1.0.0/charges   -> 200
 *   /rest/QARoom+Payment+Provider+(mock)/1.0.0/charges         -> 200   (`+` is FINE)
 *   /rest/QARoom%20Payment%20Provider%20%28mock%29/1.0.0/...   -> 404
 *   /rest/QARoom+Payment+Provider+%28mock%29/1.0.0/...         -> 404
 * So percent-encoding the PARENS is the entire failure mode; `%20` vs `+` makes no difference.
 * The long-standing comment in values.yaml blamed `+` as well, which would send someone fixing a
 * URL that already works.
 */
const CONFIGMAP_PATH = 'deploy/observability/microcks.yaml'
const COMMITTED_PATH = 'services/donations/payment-provider.openapi.yaml'
const VALUES_PATH = 'deploy/donations/values.yaml'

/** Pull the inlined `payment-provider.openapi.yaml` block out of the ConfigMap. */
export function configMapSpecText(root: string): string {
  const raw = readFileSync(resolve(root, CONFIGMAP_PATH), 'utf8')
  const doc = raw.split(/^---$/m).find((d) => d.includes('payment-provider.openapi.yaml: |'))
  if (doc === undefined) throw new Error(`no payment-provider spec block in ${CONFIGMAP_PATH}`)
  const parsed = parse(doc) as { data?: Record<string, string> }
  const text = parsed.data?.['payment-provider.openapi.yaml']
  if (typeof text !== 'string') throw new Error(`ConfigMap data key missing in ${CONFIGMAP_PATH}`)
  return text
}

export function committedSpecText(root: string): string {
  return readFileSync(resolve(root, COMMITTED_PATH), 'utf8')
}

/**
 * The parts of the contract that must agree between the two copies: paths, and the component
 * schemas. Prose (`description`, `summary`) and `servers` are deliberately excluded — the
 * committed file is the documented one and carries the narrative, while the ConfigMap is a
 * deployment artifact. What must never differ is the SHAPE Microcks serves and a consumer codes
 * against.
 */
export function contractShape(specText: string): unknown {
  const doc = parse(specText) as Record<string, unknown>
  return stripProse({ paths: doc.paths, components: doc.components })
}

/** Prose keys carry no contract meaning; they are stripped at every depth, not just the root. */
const PROSE_KEYS = new Set(['summary', 'description', 'externalDocs', 'tags'])

function stripProse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProse)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !PROSE_KEYS.has(k))
      .map(([k, v]) => [k, stripProse(v)]),
  )
}

/** `info.title` + `info.version`, the two fields Microcks builds the mock URL from. */
export function mockIdentity(specText: string): { title: string; version: string } {
  const doc = parse(specText) as { info?: { title?: unknown; version?: unknown } }
  return { title: String(doc.info?.title ?? ''), version: String(doc.info?.version ?? '') }
}

/**
 * The mock path Microcks serves for a given identity. Spaces are percent-encoded (`+` also works,
 * measured) and parens are left LITERAL, which is the part that actually matters.
 */
export function expectedMockPath(identity: { title: string; version: string }): string {
  const title = identity.title.replace(/ /g, '%20')
  return `/rest/${title}/${identity.version}`
}

/** `PAYMENT_PROVIDER_BASE_URL` as committed in deploy/donations/values.yaml. */
export function paymentBaseUrl(root: string): string {
  const values = parse(readFileSync(resolve(root, VALUES_PATH), 'utf8')) as {
    extraEnv?: Record<string, unknown>
  }
  const url = values.extraEnv?.PAYMENT_PROVIDER_BASE_URL
  if (typeof url !== 'string')
    throw new Error(`PAYMENT_PROVIDER_BASE_URL missing in ${VALUES_PATH}`)
  return url
}

/** Percent-encoded parens are the measured 404 cause; flag them wherever they appear in a mock URL. */
export function hasEncodedParens(url: string): boolean {
  return /%28|%29/i.test(url)
}

/**
 * The import Job's name carries a checksum of the inlined spec. A Job's pod template is IMMUTABLE,
 * so `kubectl apply` never re-creates a fixed-name Job: editing the spec would leave Microcks
 * serving the PREVIOUS artifact with nothing indicating it, and the mock would silently disagree
 * with the committed contract. Changing the name on a spec change forces a fresh import.
 */
export function specChecksum(specText: string): string {
  return createHash('sha256').update(specText).digest('hex').slice(0, 12)
}

/** The checksum currently baked into the import Job's name, or null if the name has no suffix. */
export function importJobChecksum(root: string): string | null {
  const raw = readFileSync(resolve(root, CONFIGMAP_PATH), 'utf8')
  return raw.match(/name: qaroom-microcks-import-([0-9a-f]{12})\b/)?.[1] ?? null
}
