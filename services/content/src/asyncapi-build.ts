import { writeDoc } from '@qaroom/service-kit'
import { contentAsyncApiYaml } from './asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', contentAsyncApiYaml)
