import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { donationsOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, donationsOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
