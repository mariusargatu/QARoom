import { writeDoc } from '@qaroom/service-kit'
import { contentAsyncApiYaml } from './contract/asyncapi-document'

writeDoc(import.meta.dirname, 'asyncapi', contentAsyncApiYaml)
