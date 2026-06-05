import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { webhooksOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, webhooksOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
