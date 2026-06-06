import { writeDoc } from '@qaroom/service-kit'
import { flagsAsyncApiYaml } from './asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', flagsAsyncApiYaml)
