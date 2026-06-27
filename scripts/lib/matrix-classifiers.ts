/**
 * Technique-group classification by file path for the detection matrix: ORDER MATTERS (first match
 * wins). One vitest sweep fills many matrix columns by classifying its failing files; same for pytest.
 *
 * Split out of `manifests/detection-matrix.ts` (T23, ADR-0033): the toggle manifest is an invariant
 * source under CODEOWNERS, but these classifiers are pure path→group helpers, not invariant data —
 * keeping them here keeps the manifest file focused (and under the 500-line cap). Imported by
 * `scripts/lib/matrix-run.ts`.
 */

export const TS_TECHNIQUE_CLASSIFIERS: readonly (readonly [RegExp, string])[] = [
  [/\.property\.test\.ts$/, 'property'],
  [/(\.mbt\.spec\.ts|stateful\.pbt\.spec\.ts)$/, 'mbt'],
  [/reverse-conformance/, 'reverse-conformance'],
  [/crosscheck/, 'pact-oas-crosscheck'],
  [/tests\/contracts\//, 'pact'],
  [/\.spec\.ts$/, 'integration'],
  [/\.test\.ts$/, 'unit'],
]

export const PY_TECHNIQUE_CLASSIFIERS: readonly (readonly [RegExp, string])[] = [
  [/test_metamorphic/, 'metamorphic'],
  [/test_(workflow|drift|schemas_crosslang|subjects_crosslang)/, 'py-conformance'],
  [/evals\/deepeval\//, 'deepeval'],
  [/evals\/redteam\//, 'redteam'],
  [/test_/, 'py-unit'],
]

export const classifyTechnique = (
  file: string,
  classifiers: readonly (readonly [RegExp, string])[],
): string => classifiers.find(([re]) => re.test(file))?.[1] ?? 'other'
