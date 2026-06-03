import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gatewayOpenApiYaml } from './openapi-document'

const outPath = resolve(import.meta.dirname, '..', 'openapi.yaml')
writeFileSync(outPath, gatewayOpenApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
