import { writeDoc } from '@qaroom/service-kit'
import { webhooksAsyncApiYaml } from './contract/asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', webhooksAsyncApiYaml)
