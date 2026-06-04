import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flagsAsyncApiYaml } from './asyncapi-document'

const outPath = resolve(import.meta.dirname, '..', 'asyncapi.yaml')
writeFileSync(outPath, flagsAsyncApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
