import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Write a generated `<kind>.yaml` to the service root, invoked by each service's
 * `src/{openapi,asyncapi}-build.ts` (run via the `openapi:generate`/`asyncapi:generate` tasks).
 * `scriptDir` is the calling script's `import.meta.dirname`; the doc lands one level up, next to
 * the service's `package.json`. Byte-for-byte output is the `render()` result, so the drift gate
 * (`openapi:verify`/`asyncapi:verify`) sees no change versus hand-written builders.
 */
export function writeDoc(
  scriptDir: string,
  kind: 'openapi' | 'asyncapi',
  render: () => string,
): void {
  const outPath = resolve(scriptDir, '..', `${kind}.yaml`)
  writeFileSync(outPath, render())
  process.stdout.write(`wrote ${outPath}\n`)
}
