import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'

/**
 * The `deploy/observability/*.yaml` glob is APPLIED, not just read: `.github/actions/cluster-up`
 * loops `kubectl apply -f` over it (under `bash -e`, so the first failure aborts the whole step)
 * and the nightly `chart` lane runs `kubeconform -strict` over the same glob. A file in that
 * directory that is not a Kubernetes manifest therefore takes down cluster bring-up for every
 * cluster lane — tracetest, cluster-smoke, chaos — before a single assertion runs.
 *
 * That is not hypothetical: `alerts.gen.yaml` + `alerts.test.yaml` (a Prometheus rule file and a
 * promtool suite, ADR-0034) landed here on 2026-06-27 and killed the nightly integration tier
 * until they were moved to `rules/` — a non-recursive glob does not descend, so the subdirectory
 * is the structural fix. This gate makes the NEXT such file fail on the PR lane in seconds instead
 * of silently red-lining the nightly for a month.
 *
 * Runs in `pnpm test:scripts`, which `ci.yml`'s required `verify` job executes on every PR.
 */
const ROOT = process.cwd()
const OBSERVABILITY_GLOB = 'deploy/observability/*.yaml'

/** One YAML document that `kubectl apply` will be handed, tagged with where it came from. */
interface AppliedDocument {
  file: string
  /** 1-based index within the file, so a multi-doc manifest names the offending document. */
  docIndex: number
  apiVersion: unknown
  kind: unknown
}

/**
 * Every document `kubectl apply -f` would see, flattened across the glob. Empty documents (a
 * trailing `---`, a comment-only file) are dropped: kubectl skips them, so they are not offenders.
 */
function appliedDocuments(): AppliedDocument[] {
  return globSync(OBSERVABILITY_GLOB, { cwd: ROOT })
    .sort()
    .flatMap((file) =>
      parseAllDocuments(readFileSync(resolve(ROOT, file), 'utf8'))
        .map((doc, index) => ({ file, docIndex: index + 1, value: doc.toJS() as unknown }))
        .filter((d) => d.value !== null && typeof d.value === 'object')
        .map(({ file: f, docIndex, value }) => {
          const record = value as Record<string, unknown>
          return { file: f, docIndex, apiVersion: record.apiVersion, kind: record.kind }
        }),
    )
}

const DOCUMENTS = appliedDocuments()

describe('every deploy/observability/*.yaml document survives kubectl apply', () => {
  it('finds documents to check, so an empty glob cannot vacuously pass this gate', () => {
    expect(DOCUMENTS.length).toBeGreaterThan(0)
  })

  it.each(
    DOCUMENTS.map((d) => ({ d, name: `${d.file}#${d.docIndex}` })),
  )('declares apiVersion and kind: $name', ({ d }) => {
    // kubectl rejects a document missing either key with "apiVersion not set, kind not set" and
    // exits 1; kubeconform reports "missing 'kind' key". Assert both at once so the failure
    // message names the file and document, not just a boolean.
    expect({ apiVersion: typeof d.apiVersion, kind: typeof d.kind }).toEqual({
      apiVersion: 'string',
      kind: 'string',
    })
  })
})
