import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { breakingManifestChanges } from '../services/qaroom-mcp/src/manifest/diff'
import { McpManifest } from '../services/qaroom-mcp/src/schema/mcp'

/**
 * The MCP tool-manifest gate (ADR-0006), mirroring `openapi-verify.ts`:
 *   1a. Drift — regenerate the manifest from the operation registries and fail if the
 *       committed file is stale (the round-trip must hold).
 *   1b. Breaking changes — prove the typed classifier passes for an identical/widened
 *       manifest AND fails for a deliberately removed tool (the self-test that the gate works).
 */
const ROOT = process.cwd()
const manifestPath = resolve(ROOT, 'services/qaroom-mcp/mcp-manifest.json')

const before = readFileSync(manifestPath, 'utf8')
execFileSync('pnpm', ['--filter', '@qaroom/qaroom-mcp', 'mcp:generate'], {
  cwd: ROOT,
  stdio: 'inherit',
})
const after = readFileSync(manifestPath, 'utf8')
if (before !== after) {
  process.stderr.write(
    'MCP manifest drift: committed services/qaroom-mcp/mcp-manifest.json was stale. It has been regenerated — commit the result.\n',
  )
  process.exit(1)
}
process.stdout.write('mcp manifest drift gate: committed manifest matches the registries ✓\n')

const committed = McpManifest.parse(JSON.parse(after))
const firstTool = committed.tools[0]
if (!firstTool) {
  process.stderr.write('manifest has no tools — cannot self-test the classifier.\n')
  process.exit(1)
}
const widened = McpManifest.parse({
  ...committed,
  tools: [...committed.tools, { ...firstTool, name: 'content_synthetic' }],
})
const broken = McpManifest.parse({ ...committed, tools: committed.tools.slice(1) })

if (breakingManifestChanges(committed, committed).length !== 0) {
  process.stderr.write(
    'classifier flagged an identical manifest as breaking — gate misconfigured.\n',
  )
  process.exit(1)
}
if (breakingManifestChanges(committed, widened).length !== 0) {
  process.stderr.write(
    'classifier flagged an additive widening as breaking — gate misconfigured.\n',
  )
  process.exit(1)
}
if (breakingManifestChanges(committed, broken).length === 0) {
  process.stderr.write('classifier did NOT detect a removed tool — gate is broken.\n')
  process.exit(1)
}
process.stdout.write(
  'mcp manifest breaking-change gate: identical + widening pass, removed-tool detected ✓\n',
)
