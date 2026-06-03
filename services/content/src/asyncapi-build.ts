import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contentAsyncApiYaml } from './asyncapi-document'

const outPath = resolve(import.meta.dirname, '..', 'asyncapi.yaml')
writeFileSync(outPath, contentAsyncApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
