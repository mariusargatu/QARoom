import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildManifest, stringifyManifest } from './build-manifest'

/** `pnpm --filter @qaroom/qaroom-mcp mcp:generate` — regenerate the committed manifest. */
const outPath = resolve(import.meta.dirname, '..', '..', 'mcp-manifest.json')
writeFileSync(outPath, stringifyManifest(buildManifest()))
process.stdout.write(`wrote ${outPath}\n`)
