import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contentOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, contentOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
