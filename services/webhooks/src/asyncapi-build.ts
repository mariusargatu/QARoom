import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { webhooksAsyncApiYaml } from './asyncapi-document'

const outPath = resolve(import.meta.dirname, '..', 'asyncapi.yaml')
writeFileSync(outPath, webhooksAsyncApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
