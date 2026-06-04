import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { donationsAsyncApiYaml } from './asyncapi-document'

const outPath = resolve(import.meta.dirname, '..', 'asyncapi.yaml')
writeFileSync(outPath, donationsAsyncApiYaml())
process.stdout.write(`wrote ${outPath}\n`)
