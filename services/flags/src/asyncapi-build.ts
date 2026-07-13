import { writeDoc } from '@qaroom/service-kit'
import { flagsAsyncApiYaml } from './contract/asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', flagsAsyncApiYaml)
