import { writeDoc } from '@qaroom/service-kit'
import { webhooksAsyncApiYaml } from './asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', webhooksAsyncApiYaml)
