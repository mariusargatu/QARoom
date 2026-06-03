import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { identityOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, identityOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
