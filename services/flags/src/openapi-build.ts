import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flagsOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, flagsOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
